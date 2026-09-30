import { randomBytes, randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secrets.js";
import { logger } from "../../shared/utils/logger.js";
import { mutateBillPayment } from "../billing/billing-payments.service.js";
import { roundMoney, summarizePayments } from "../billing/billing-depth.utils.js";
import { fromPaise, razorpay, RazorpayError, toPaise, validWebhookSignature } from "./razorpay.js";

/**
 * Card/UPI payments through each restaurant's own Razorpay account.
 *
 * A bill's payment request becomes a Razorpay UPI QR code (shown at the till) or a payment link (sent by SMS). Money is
 * confirmed only from Razorpay itself - a signed webhook, or the till asking Razorpay directly - and only when the
 * captured amount, currency and request match exactly. Each Razorpay payment is recorded once. A payment that arrives
 * for a request that was cancelled, or for a bill already paid another way, is refunded automatically; if that refund
 * fails the request is flagged for a manager. Refunds are made at Razorpay first and recorded after, with a key that
 * makes a retry reuse the same Razorpay refund instead of refunding twice.
 */
const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
const SYSTEM_ACTOR = { id: "razorpay", name: "Razorpay", role: "System" };
const QR_MINUTES = 30;
const LINK_HOURS = 24;
const intentKey = (businessId, id) => `payment-intent:${encodeURIComponent(businessId)}:${id}`;
const lockIntent = (tx, id) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-intent:${id}`}))`;
const newKey = () => randomBytes(24).toString("base64url");
const methodLabel = (method) => ({ upi: "UPI", card: "Card", netbanking: "Net banking", wallet: "Wallet", emi: "EMI" }[String(method || "").toLowerCase()] || "UPI");

const publicBase = () => String(process.env.POS_PUBLIC_API_URL || process.env.POS_BASE_URL || "").replace(/\/+$/, "");

// ---------------------------------------------------------------- settings
export const loadGatewayConfig = async (businessId, client = prisma) => {
  const existing = await client.paymentGatewayConfig.findUnique({ where: { businessId } });
  if (existing) return existing;
  return client.paymentGatewayConfig.upsert({ where: { businessId }, update: {}, create: { businessId, webhookKey: newKey() } });
};

const serializeConfig = (config) => ({
  provider: "razorpay",
  enabled: config.enabled,
  key_id: config.keyId,
  mode: config.keyId?.startsWith("rzp_live_") ? "live" : config.keyId?.startsWith("rzp_test_") ? "test" : null,
  key_secret_set: Boolean(config.keySecretEnc),
  webhook_secret_set: Boolean(config.webhookSecretEnc),
  webhook_url: `${publicBase() || "https://YOUR-POS-API"}/api/public/payments/razorpay/webhook/${config.webhookKey}`,
  webhook_events: ["payment.captured", "qr_code.credited", "payment_link.paid", "refund.processed", "refund.failed"],
});

class GatewayService {
  async getConfig({ businessId }) {
    return serializeConfig(await loadGatewayConfig(businessId));
  }

  /** The till only needs to know whether to offer Razorpay. */
  async status({ businessId }) {
    const config = await prisma.paymentGatewayConfig.findUnique({ where: { businessId } });
    return { enabled: Boolean(config?.enabled), provider: "razorpay" };
  }

  async saveConfig({ businessId, payload = {} }) {
    const current = await loadGatewayConfig(businessId);
    const data = {};
    if (payload.key_id !== undefined) {
      const keyId = String(payload.key_id || "").trim();
      if (keyId && !/^rzp_(live|test)_[A-Za-z0-9]{8,32}$/.test(keyId)) fail(400, "GATEWAY_INVALID", "The Key ID starts with rzp_live_ or rzp_test_");
      data.keyId = keyId || null;
    }
    // Secrets are only replaced when a new value is typed.
    if (payload.key_secret) data.keySecretEnc = encryptSecret(String(payload.key_secret).trim());
    if (payload.webhook_secret) data.webhookSecretEnc = encryptSecret(String(payload.webhook_secret).trim());
    if (payload.regenerate_webhook_url) data.webhookKey = newKey();
    if (payload.enabled !== undefined) data.enabled = Boolean(payload.enabled);
    const next = { ...current, ...data };
    if (next.enabled) {
      if (!next.keyId || !next.keySecretEnc || !next.webhookSecretEnc) fail(400, "GATEWAY_INVALID", "Enter the Key ID, Key Secret and webhook secret before switching Razorpay on");
      // Only keys Razorpay accepts can be switched on.
      try {
        await razorpay.verifyKeys(next);
      } catch (error) {
        fail(400, "GATEWAY_KEYS_REJECTED", error instanceof RazorpayError ? error.message : "Could not check the keys with Razorpay");
      }
    }
    return serializeConfig(await prisma.paymentGatewayConfig.update({ where: { businessId }, data }));
  }

  /** A strong webhook secret to paste into the Razorpay dashboard. Shown once; only its encrypted form is kept. */
  async generateWebhookSecret({ businessId }) {
    await loadGatewayConfig(businessId);
    const secret = randomBytes(24).toString("base64url");
    await prisma.paymentGatewayConfig.update({ where: { businessId }, data: { webhookSecretEnc: encryptSecret(secret) } });
    return { webhook_secret: secret };
  }

  async requireEnabled(businessId) {
    const config = await prisma.paymentGatewayConfig.findUnique({ where: { businessId } });
    if (!config?.enabled) fail(409, "GATEWAY_NOT_ENABLED", "Razorpay is not switched on for this business");
    return config;
  }

  // ---------------------------------------------------------------- creating requests
  /** Called by paymentsService.createIntent for a bill that owes money. The intent is saved first, then Razorpay. */
  async startIntent({ businessId, intent, mode, customerPhone, description }) {
    const config = await this.requireEnabled(businessId);
    const amount = toPaise(intent.amount);
    const notes = { intent_id: intent.id, business_id: businessId, bill_id: intent.invoiceId || "" };
    try {
      if (mode === "link") {
        const link = await razorpay.createLink(config, {
          amount, currency: "INR", accept_partial: false, description: String(description || "Bill payment").slice(0, 2048),
          reference_id: intent.id.replace(/^payint_/, "").slice(0, 40),
          expire_by: Math.floor(Date.now() / 1000) + LINK_HOURS * 3600,
          ...(customerPhone ? { customer: { contact: customerPhone }, notify: { sms: true, email: false } } : { notify: { sms: false, email: false } }),
          reminder_enable: false, notes,
        });
        return { mode: "link", link_id: link.id, short_url: link.short_url, expires_at: new Date((link.expire_by || 0) * 1000).toISOString() };
      }
      const qr = await razorpay.createQr(config, {
        type: "upi_qr", name: String(description || "Bill payment").slice(0, 40), usage: "single_use", fixed_amount: true,
        payment_amount: amount, description: String(description || "Bill payment").slice(0, 100),
        close_by: Math.floor(Date.now() / 1000) + QR_MINUTES * 60, notes,
      });
      return { mode: "qr", qr_id: qr.id, image_url: qr.image_url, expires_at: new Date((qr.close_by || 0) * 1000).toISOString() };
    } catch (error) {
      fail(502, "GATEWAY_REQUEST_FAILED", error instanceof RazorpayError ? error.message : "Could not create the Razorpay payment request");
    }
    return null;
  }

  // ---------------------------------------------------------------- settling payments
  /**
   * Applies one Razorpay payment to its request. Safe to call any number of times, from the webhook or from polling.
   * Returns the intent as stored afterwards.
   */
  async settlePayment({ businessId, intentId, payment, config }) {
    if (!payment?.id) return null;
    if (payment.status === "authorized") {
      // Accounts without auto-capture: capture exactly the requested amount now.
      payment = await razorpay.capture(config, payment.id, payment.amount);
    }
    if (payment.status !== "captured") return null;
    const key = intentKey(businessId, intentId);
    const outcome = await prisma.$transaction(async (tx) => {
      await lockIntent(tx, intentId);
      const row = await tx.stateDocument.findUnique({ where: { key } });
      const intent = row?.data;
      if (!intent || intent.businessId !== businessId || intent.provider !== "razorpay") return { intent: null };
      const gateway = intent.providerPayload?.gateway || {};
      if (gateway.payment_id === payment.id) return { intent };
      if (gateway.payment_id && gateway.payment_id !== payment.id) return { intent, refund: "second_payment" };
      const exact = Number(payment.amount) === toPaise(intent.amount) && String(payment.currency || "INR") === "INR";
      if (!exact) return { intent, refund: "amount_mismatch" };
      if (intent.status !== "pending") return { intent, refund: "request_closed" };
      return { intent, settle: true };
    });
    if (!outcome.intent) return null;
    // Already recorded (Razorpay reports one payment through several events): nothing more to do.
    if (!outcome.settle && !outcome.refund) return outcome.intent;
    if (outcome.settle) {
      let refund = null;
      try {
        await mutateBillPayment({
          tenantId: outcome.intent.tenantId, invoiceId: outcome.intent.invoiceId, action: "gateway_payment", system: true, user: SYSTEM_ACTOR,
          payload: { amount: outcome.intent.amount, method: methodLabel(payment.method), gateway_payment_id: payment.id, pending_payment_id: outcome.intent.billPaymentId, intent_id: intentId },
        });
      } catch (error) {
        // The bill was voided or already paid another way: the customer must get this money back.
        if ([409, 404].includes(error.statusCode)) refund = "bill_closed";
        else throw error;
      }
      if (!refund) return this.updateIntent(businessId, intentId, (intent) => ({
        ...intent, status: "confirmed", reference: payment.id, confirmedAt: new Date().toISOString(),
        providerPayload: { ...intent.providerPayload, gateway: { ...intent.providerPayload?.gateway, payment_id: payment.id, method: payment.method || null } },
      }));
      outcome.refund = refund;
    }
    return this.refundUnwanted({ businessId, intentId, payment, config, reason: outcome.refund });
  }

  /** Money that must not be kept (late, duplicate or wrong amount): refunded in full, or flagged if that fails. */
  async refundUnwanted({ businessId, intentId, payment, config, reason }) {
    const current = await this.readIntent(businessId, intentId);
    const handled = current?.providerPayload?.unwanted_payments || [];
    if (handled.some((row) => row.payment_id === payment.id && row.refund_id)) return current;
    let refundId = null;
    let error = null;
    try {
      const existing = await razorpay.listRefunds(config, payment.id);
      const already = (existing?.items || []).find((row) => row.notes?.pos_reason === "unwanted");
      refundId = already?.id || (await razorpay.refund(config, payment.id, { amount: payment.amount, speed: "normal", notes: { pos_reason: "unwanted", intent_id: intentId } })).id;
    } catch (refundError) {
      error = refundError.message;
      logger.warn(`Razorpay payment ${payment.id} needs a manual refund: ${refundError.message}`);
    }
    return this.updateIntent(businessId, intentId, (intent) => ({
      ...intent,
      needs_attention: !refundId || intent.needs_attention || false,
      providerPayload: {
        ...intent.providerPayload,
        unwanted_payments: [...(intent.providerPayload?.unwanted_payments || []).filter((row) => row.payment_id !== payment.id),
          { payment_id: payment.id, amount: fromPaise(payment.amount), reason, refund_id: refundId, error, at: new Date().toISOString() }],
      },
    }));
  }

  async readIntent(businessId, intentId) {
    const row = await prisma.stateDocument.findUnique({ where: { key: intentKey(businessId, intentId) } });
    return row?.data?.businessId === businessId ? row.data : null;
  }

  async updateIntent(businessId, intentId, change) {
    return prisma.$transaction(async (tx) => {
      await lockIntent(tx, intentId);
      const key = intentKey(businessId, intentId);
      const row = await tx.stateDocument.findUnique({ where: { key } });
      if (!row) return null;
      const next = { ...change(row.data), updatedAt: new Date().toISOString() };
      await tx.stateDocument.update({ where: { key }, data: { data: next } });
      return next;
    });
  }

  /** Asks Razorpay whether a request has been paid (used by the till while the QR is on screen). */
  async refresh({ businessId, intentId }) {
    const intent = await this.readIntent(businessId, intentId);
    if (!intent || intent.provider !== "razorpay") fail(404, "INTENT_NOT_FOUND", "Payment request not found");
    if (intent.status !== "pending") return intent;
    const config = await loadGatewayConfig(businessId);
    for (const payment of await this.paymentsFor(config, intent)) {
      await this.settlePayment({ businessId, intentId, payment, config });
    }
    return this.readIntent(businessId, intentId);
  }

  async paymentsFor(config, intent) {
    const gateway = intent.providerPayload?.gateway || {};
    try {
      if (gateway.qr_id) return (await razorpay.qrPayments(config, gateway.qr_id))?.items || [];
      if (gateway.link_id) {
        const link = await razorpay.fetchLink(config, gateway.link_id);
        const ids = (link?.payments || []).map((row) => row.payment_id).filter(Boolean);
        return Promise.all(ids.map((id) => razorpay.fetchPayment(config, id)));
      }
    } catch (error) {
      if (error instanceof RazorpayError && error.retryable) return [];
      throw createHttpError({ statusCode: 502, code: "GATEWAY_REQUEST_FAILED", message: error.message });
    }
    return [];
  }

  /** Stops a request (customer pays another way). Anything paid meanwhile is still recorded or refunded. */
  async cancel({ businessId, intentId }) {
    const intent = await this.readIntent(businessId, intentId);
    if (!intent || intent.provider !== "razorpay") fail(404, "INTENT_NOT_FOUND", "Payment request not found");
    if (intent.status !== "pending") return intent;
    const config = await loadGatewayConfig(businessId);
    const gateway = intent.providerPayload?.gateway || {};
    try {
      if (gateway.qr_id) await razorpay.closeQr(config, gateway.qr_id);
      if (gateway.link_id) await razorpay.cancelLink(config, gateway.link_id);
    } catch (error) {
      // A link that was just paid cannot be cancelled; the payment check below records it.
      logger.warn(`Razorpay request for intent ${intentId} could not be closed: ${error.message}`);
    }
    for (const payment of await this.paymentsFor(config, intent)) await this.settlePayment({ businessId, intentId, payment, config });
    const after = await this.readIntent(businessId, intentId);
    if (after.status !== "pending") return after;
    return this.updateIntent(businessId, intentId, (current) => (current.status === "pending" ? { ...current, status: "cancelled" } : current));
  }

  // ---------------------------------------------------------------- refunds
  /**
   * Refunds part of a bill to the customer's UPI/card at Razorpay, then records it on the bill. The Razorpay refunds
   * carry a key, so retrying the same request (same client_request_id) reuses them instead of refunding twice.
   */
  async refundBill({ tenantId, invoiceId, payload = {}, user }) {
    if (!["Owner", "Manager"].includes(user?.role)) fail(403, "MANAGER_REQUIRED", "Manager approval is required for refunds");
    const reason = String(payload.reason || "").trim();
    if (!reason) fail(400, "REASON_REQUIRED", "Refund reason is required");
    const amount = roundMoney(payload.amount);
    if (!(amount > 0)) fail(400, "REFUND_INVALID", "Refund must be a positive amount");
    const bill = await prisma.bill.findFirst({ where: { id: invoiceId, business: { tenantId } } });
    if (!bill) fail(404, "INVOICE_NOT_FOUND", "Invoice not found");
    const config = await this.requireEnabled(bill.businessId);
    const metadata = bill.metadata || {};
    const requestKey = String(payload.client_request_id || "").trim().slice(0, 60) || `rf_${randomUUID()}`;
    if ((metadata.refunds || []).some((row) => row.client_request_id === requestKey)) {
      return mutateBillPayment({ tenantId, invoiceId, action: "refund", user, payload: { ...payload, client_request_id: requestKey }, gatewayRefunds: [] });
    }
    const paid = summarizePayments(metadata.payments || [], bill.total).paid_amount;
    const refundedTotal = (metadata.refunds || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (amount > roundMoney(paid - refundedTotal)) fail(400, "REFUND_TOO_LARGE", "Refund exceeds the remaining collected amount");
    // How much each Razorpay payment on the bill can still give back.
    const refundedByPayment = new Map();
    for (const refund of metadata.refunds || []) {
      for (const row of refund.gateway_refunds || []) refundedByPayment.set(row.payment_id, roundMoney((refundedByPayment.get(row.payment_id) || 0) + Number(row.amount)));
    }
    const sources = (metadata.payments || []).filter((row) => row.status === "confirmed" && row.gateway === "razorpay" && row.gateway_payment_id)
      .map((row) => ({ paymentId: row.gateway_payment_id, room: roundMoney(Number(row.amount) - (refundedByPayment.get(row.gateway_payment_id) || 0)) }))
      .filter((row) => row.room > 0);
    const available = roundMoney(sources.reduce((sum, row) => sum + row.room, 0));
    if (amount > available) fail(400, "REFUND_TOO_LARGE", `Only ${available.toFixed(2)} was paid through Razorpay and can go back that way`);

    const done = [];
    let left = amount;
    let failure = null;
    for (const source of sources) {
      if (left <= 0) break;
      const part = roundMoney(Math.min(left, source.room));
      const partKey = `${requestKey}:${source.paymentId}`;
      try {
        const existing = await razorpay.listRefunds(config, source.paymentId);
        const already = (existing?.items || []).find((row) => row.notes?.pos_refund_key === partKey);
        const refund = already || await razorpay.refund(config, source.paymentId, {
          amount: toPaise(part), speed: "normal", receipt: requestKey.slice(0, 40), notes: { pos_refund_key: partKey, bill_id: invoiceId },
        });
        done.push({ payment_id: source.paymentId, refund_id: refund.id, amount: fromPaise(refund.amount), status: refund.status || "pending" });
        left = roundMoney(left - fromPaise(refund.amount));
      } catch (error) {
        failure = error;
        break;
      }
    }
    if (!done.length) fail(502, "GATEWAY_REFUND_FAILED", failure?.message || "Razorpay did not accept the refund");
    const refunded = roundMoney(done.reduce((sum, row) => sum + row.amount, 0));
    // Whatever Razorpay refunded is recorded, even if part of the request failed, so the books match the money.
    const result = await mutateBillPayment({
      tenantId, invoiceId, action: "refund", user, gatewayRefunds: done,
      payload: { amount: refunded, reason, client_request_id: requestKey },
    });
    if (failure) {
      fail(502, "GATEWAY_REFUND_PARTIAL", `Only ${refunded.toFixed(2)} was refunded through Razorpay (${failure.message}). The rest was not refunded; try again or refund it in cash.`);
    }
    return result;
  }

  // ---------------------------------------------------------------- webhooks
  /** Returns an HTTP status: 200 applied or ignored, 401 bad signature, 404 unknown URL, 500 retry later. */
  async receiveWebhook({ key, rawBody, signature, eventId, body }) {
    const config = await prisma.paymentGatewayConfig.findUnique({ where: { webhookKey: String(key || "") } });
    if (!config) return 404;
    if (!validWebhookSignature(rawBody, signature, decryptSecret(config.webhookSecretEnc))) return 401;
    const id = String(eventId || "").trim();
    if (id && await prisma.paymentGatewayEvent.findUnique({ where: { id } })) return 200;
    const event = String(body?.event || "");
    const payload = body?.payload || {};
    const payment = payload.payment?.entity || null;
    const intentId = payload.qr_code?.entity?.notes?.intent_id || payload.payment_link?.entity?.notes?.intent_id || payment?.notes?.intent_id || null;
    try {
      if (["payment.captured", "qr_code.credited", "payment_link.paid", "payment.authorized"].includes(event) && payment && intentId) {
        const intent = await this.readIntent(config.businessId, intentId);
        // The request must belong to this business and to the Razorpay object that was paid.
        const gateway = intent?.providerPayload?.gateway || {};
        const sameSource = (payload.qr_code?.entity?.id ? payload.qr_code.entity.id === gateway.qr_id : true)
          && (payload.payment_link?.entity?.id ? payload.payment_link.entity.id === gateway.link_id : true);
        if (intent && sameSource) await this.settlePayment({ businessId: config.businessId, intentId, payment, config });
      } else if (["refund.processed", "refund.failed"].includes(event)) {
        await this.applyRefundStatus(config.businessId, payload.refund?.entity);
      }
    } catch (error) {
      logger.warn(`Razorpay webhook ${event} not applied yet: ${error.message}`);
      return 500;
    }
    if (id) await prisma.paymentGatewayEvent.create({ data: { id, businessId: config.businessId, event: event.slice(0, 60) } }).catch(() => {});
    return 200;
  }

  async applyRefundStatus(businessId, refund) {
    const billId = refund?.notes?.bill_id;
    if (!refund?.id || !billId) return;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${billId}`}))`;
      const bill = await tx.bill.findFirst({ where: { id: billId, businessId } });
      if (!bill) return;
      let changed = false;
      const refunds = (bill.metadata?.refunds || []).map((row) => ({
        ...row,
        gateway_refunds: (row.gateway_refunds || []).map((part) => {
          if (part.refund_id !== refund.id || part.status === refund.status) return part;
          changed = true;
          return { ...part, status: refund.status };
        }),
      }));
      // A failed Razorpay refund means the customer has not got the money back: the bill is flagged for a manager.
      if (changed) {
        await tx.bill.update({ where: { id: bill.id }, data: { metadata: {
          ...bill.metadata, refunds, ...(refund.status === "failed" ? { gateway_refund_failed: true } : {}),
        } } });
      }
    });
  }
}

export const gatewayService = new GatewayService();
