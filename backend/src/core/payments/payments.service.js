import { randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { mutateBillPayment } from "../billing/billing-payments.service.js";
import { gatewayService } from "./gateway.service.js";

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const isManagerRole = (user) => ["owner", "manager"].includes(String(user?.role || "").trim().toLowerCase());

const intentPrefix = (businessId) => `payment-intent:${encodeURIComponent(businessId)}:`;
const intentKey = (businessId, id) => `${intentPrefix(businessId)}${id}`;

const nowIso = () => new Date().toISOString();

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildUpiDeepLink = ({ upiId, payeeName, amount, note, reference }) => {
  if (!upiId) {
    return null;
  }

  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName || "CashFlow POS",
    am: toNumber(amount, 0).toFixed(2),
    cu: "INR",
    tn: note || reference || "POS payment",
  });

  if (reference) {
    params.set("tr", reference);
  }

  return `upi://pay?${params.toString()}`;
};

const serializeIntent = (intent) => ({
  id: intent.id,
  business_id: intent.businessId,
  tenant_id: intent.tenantId,
  provider: intent.provider,
  method: intent.method,
  status: intent.status,
  amount: intent.amount,
  currency: intent.currency,
  reference: intent.reference,
  invoice_id: intent.invoiceId,
  bill_payment_id: intent.billPaymentId || null,
  order_id: intent.orderId,
  customer_phone: intent.customerPhone,
  upi_deep_link: intent.upiDeepLink,
  qr_payload: intent.qrPayload,
  provider_payload: intent.provider === "razorpay" ? { mode: intent.providerPayload?.mode || null } : intent.providerPayload,
  created_at: intent.createdAt,
  updated_at: intent.updatedAt,
  confirmed_at: intent.confirmedAt,
  needs_attention: Boolean(intent.needs_attention),
  razorpay: intent.provider === "razorpay" ? {
    mode: intent.providerPayload?.mode || null,
    image_url: intent.providerPayload?.gateway?.image_url || null,
    short_url: intent.providerPayload?.gateway?.short_url || null,
    expires_at: intent.providerPayload?.gateway?.expires_at || null,
    payment_id: intent.providerPayload?.gateway?.payment_id || null,
    unwanted_payments: intent.providerPayload?.unwanted_payments || [],
  } : null,
});

export class PaymentsService {
  constructor(database = prisma) {
    this.database = database;
  }

  async requireScope({ tenantId, businessId } = {}) {
    if (!tenantId || !businessId) {
      throw createHttpError({ statusCode: 403, message: "Payment business scope is required" });
    }
    const business = await this.database.business.findFirst({ where: { id: businessId, tenantId }, select: { id: true } });
    if (!business) {
      throw createHttpError({ statusCode: 403, message: "Invalid payment business scope" });
    }
    return { tenantId, businessId };
  }

  async createIntent({ payload = {}, user = null, publicRequest = false, ...scope } = {}) {
    if (publicRequest) {
      throw createHttpError({ statusCode: 503, code: "PUBLIC_PAYMENTS_NOT_CONFIGURED", message: "Public payments require a configured payment provider and verified order session" });
    }
    const { tenantId, businessId } = await this.requireScope(scope);
    const amount = toNumber(payload.amount, 0);
    if (amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
      throw createHttpError({ statusCode: 400, message: "Payment amount must be a positive monetary amount" });
    }
    const invoiceId = payload.invoice_id || payload.invoiceId || null;
    const orderId = payload.order_id || payload.orderId || null;
    for (const [model, id] of [["bill", invoiceId], ["order", orderId]]) {
      if (id && !await this.database[model].findFirst({ where: { id, businessId }, select: { id: true } })) {
        throw createHttpError({ statusCode: 404, message: "Payment invoice or order not found in this business" });
      }
    }
    const method = payload.method || payload.payment_method || "UPI";
    const viaGateway = payload.provider === "razorpay";
    if (viaGateway && !invoiceId) {
      throw createHttpError({ statusCode: 400, code: "INVOICE_REQUIRED", message: "Razorpay requests are made for a bill" });
    }
    // A bill-linked intent collects money the bill still owes, and points at the bill's own pending payment row
    // when one exists, so confirming the intent and confirming the bill payment are the same event.
    let billPaymentId = null;
    if (invoiceId) {
      const bill = await this.database.bill.findFirst({ where: { id: invoiceId, businessId }, select: { total: true, status: true, metadata: true } });
      if (["void", "refunded"].includes(bill.status)) {
        throw createHttpError({ statusCode: 409, code: "BILL_CLOSED", message: "This bill can no longer take payments" });
      }
      const payments = Array.isArray(bill.metadata?.payments) ? bill.metadata.payments : [];
      const confirmedPaid = payments.filter((row) => row.status === "confirmed").reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const due = roundMoney(Number(bill.total) - confirmedPaid);
      if (roundMoney(amount) > due) {
        throw createHttpError({ statusCode: 400, code: "AMOUNT_EXCEEDS_DUE", message: `The bill only has ${due.toFixed(2)} outstanding` });
      }
      const pending = payments.find((row) => row.status === "pending_confirmation" && roundMoney(row.amount) === roundMoney(amount)
        && String(row.method || "").toLowerCase() === String(method).toLowerCase());
      if (pending) {
        const existing = (await this.listIntents({ tenantId, businessId })).find((row) => row.bill_payment_id === pending.id && row.status === "pending"
          && (row.provider === "razorpay") === viaGateway && (!viaGateway || row.provider_payload?.mode === (payload.razorpay_mode === "link" ? "link" : "qr")));
        if (existing) return existing;
        billPaymentId = pending.id;
      }
    }
    const provider = viaGateway ? "razorpay" : (method === "UPI" ? "upi_manual" : "manual_gateway");
    const id = `payint_${randomUUID()}`;
    const reference = payload.reference || payload.transaction_reference || id;
    const upiId = payload.upi_id || process.env.UPI_MERCHANT_ID || process.env.UPI_ID || "";
    const upiDeepLink = buildUpiDeepLink({
      upiId,
      payeeName: payload.payee_name || process.env.UPI_PAYEE_NAME || "CashFlow POS",
      amount,
      note: payload.note || payload.description || "POS payment",
      reference,
    });
    const intent = {
      id,
      tenantId,
      businessId,
      provider,
      method,
      status: "pending",
      amount,
      currency: payload.currency || "INR",
      reference,
      invoiceId,
      billPaymentId,
      orderId,
      customerPhone: payload.customer_phone || payload.customerPhone || null,
      upiDeepLink,
      qrPayload: upiDeepLink,
      providerPayload: {
        mode: provider,
        public_request: Boolean(publicRequest),
        created_by: user?.id || null,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      confirmedAt: null,
    };

    if (viaGateway) {
      intent.upiDeepLink = null;
      intent.qrPayload = null;
      intent.providerPayload.mode = payload.razorpay_mode === "link" ? "link" : "qr";
    }
    await this.database.stateDocument.create({ data: { key: intentKey(businessId, id), data: intent } });
    if (!viaGateway) return serializeIntent(intent);

    // Saved first, then created at Razorpay, so a payment can never arrive for a request the POS does not know.
    let gateway;
    try {
      gateway = await gatewayService.startIntent({ businessId, intent, mode: intent.providerPayload.mode,
        customerPhone: intent.customerPhone, description: payload.note || payload.description || `Bill ${invoiceId}` });
    } catch (error) {
      await gatewayService.updateIntent(businessId, id, (current) => ({ ...current, status: "failed" }));
      throw error;
    }
    const saved = await gatewayService.updateIntent(businessId, id, (current) => ({
      ...current,
      qrPayload: gateway.image_url || gateway.short_url || null,
      providerPayload: { ...current.providerPayload, gateway },
    }));
    if (billPaymentId) {
      // The bill's waiting payment is now owned by this request, so nobody confirms it by hand as well.
      await this.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${invoiceId}`}))`;
        const bill = await tx.bill.findFirst({ where: { id: invoiceId, businessId } });
        const payments = (bill?.metadata?.payments || []).map((row) => (row.id === billPaymentId && row.status === "pending_confirmation" ? { ...row, gateway_intent_id: id } : row));
        await tx.bill.update({ where: { id: invoiceId }, data: { metadata: { ...bill.metadata, payments } } });
      });
    }
    return serializeIntent(saved);
  }

  async listIntents({ status, ...scope } = {}) {
    const { businessId, tenantId } = await this.requireScope(scope);
    const rows = await this.database.stateDocument.findMany({ where: { key: { startsWith: intentPrefix(businessId) } } });
    return rows.map((row) => row.data)
      .filter((intent) => intent.businessId === businessId && intent.tenantId === tenantId)
      .filter((intent) => !status || intent.status === status)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(serializeIntent);
  }

  async getIntent(intentId, scope = {}) {
    const { businessId, tenantId } = await this.requireScope(scope);
    const row = await this.database.stateDocument.findUnique({ where: { key: intentKey(businessId, intentId) } });
    return row?.data?.businessId === businessId && row.data.tenantId === tenantId ? serializeIntent(row.data) : null;
  }

  async refreshIntent({ intentId, ...scope }) {
    const { businessId } = await this.requireScope(scope);
    return serializeIntent(await gatewayService.refresh({ businessId, intentId }));
  }

  async cancelIntent({ intentId, ...scope }) {
    const { businessId } = await this.requireScope(scope);
    return serializeIntent(await gatewayService.cancel({ businessId, intentId }));
  }

  async confirmIntent({ intentId, payload = {}, user = null, ...scope }) {
    const { businessId, tenantId } = await this.requireScope(scope);
    const key = intentKey(businessId, intentId);
    const row = await this.database.stateDocument.findUnique({ where: { key } });
    const intent = row?.data;
    if (!intent || intent.businessId !== businessId || intent.tenantId !== tenantId) {
      return null;
    }
    if (intent.provider === "razorpay") {
      // Only Razorpay itself can confirm these; staff can cancel the request and take the payment another way.
      throw createHttpError({ statusCode: 409, code: "GATEWAY_CONFIRMS_ITSELF", message: "Razorpay payments confirm automatically. Cancel the request to take the payment another way." });
    }
    const status = payload.status || "confirmed";
    if (!["confirmed", "failed", "cancelled"].includes(status)) {
      throw createHttpError({ statusCode: 400, message: "Invalid payment confirmation status" });
    }
    if (intent.status !== "pending") {
      if (intent.status === status) return serializeIntent(intent);
      throw createHttpError({ statusCode: 409, message: "Payment already has a final status" });
    }
    const reference = String(payload.reference || payload.transaction_id || payload.utr || "").trim();
    if (status === "confirmed" && intent.invoiceId) {
      // Money on a bill is only confirmed by a manager against a real transaction reference.
      if (!isManagerRole(user)) {
        throw createHttpError({ statusCode: 403, code: "MANAGER_CONFIRMATION_REQUIRED", message: "A manager must confirm payments against a bill" });
      }
      if (!reference) {
        throw createHttpError({ statusCode: 400, code: "REFERENCE_REQUIRED", message: "Enter the bank or UPI transaction reference" });
      }
      // The bill is updated first (idempotent for the same reference); a retry after a failure below is safe.
      let billPaymentId = intent.billPaymentId;
      if (!billPaymentId) {
        const bill = await mutateBillPayment({ tenantId, invoiceId: intent.invoiceId, action: "payment", user,
          payload: { amount: intent.amount, method: intent.method, reference, client_request_id: `intent:${intent.id}` } });
        billPaymentId = (bill.payments || []).find((row) => row.client_request_id === `intent:${intent.id}`)?.id;
      }
      if (billPaymentId) {
        await mutateBillPayment({ tenantId, invoiceId: intent.invoiceId, action: "confirm", paymentId: billPaymentId, user, payload: { reference } });
      }
      intent.billPaymentId = billPaymentId || null;
    }
    intent.status = status;
    intent.reference = reference || intent.reference;
    intent.providerPayload = {
      ...(intent.providerPayload || {}),
      confirmation: payload,
      confirmed_by: user?.id || null,
    };
    intent.confirmedAt = status === "confirmed" ? nowIso() : null;
    intent.updatedAt = nowIso();
    const updated = await this.database.stateDocument.updateMany({
      where: { key, data: { path: ["status"], equals: "pending" } },
      data: { data: intent },
    });
    if (updated.count !== 1) {
      const current = await this.getIntent(intentId, scope);
      if (current?.status === status) return current;
      throw createHttpError({ statusCode: 409, message: "Payment was already updated; refresh before retrying" });
    }
    return serializeIntent(intent);
  }

  recordWebhook({ provider = "unknown", payload = {} } = {}) {
    throw createHttpError({ statusCode: 503, code: "PAYMENT_WEBHOOK_NOT_CONFIGURED", message: "Payment webhooks require a configured provider with signature verification" });
  }
}

export const paymentsService = new PaymentsService();
