import { randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { serializeBill } from "../../database/prisma/helpers.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { normalizePayments, summarizePayments, roundMoney } from "./billing-depth.utils.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";
import { lockSettlement, ensureOpenShift } from "./settlement.service.js";
import { reconcileBillCustomer } from "../customers/customer-core.js";
import { isGiftCardMethod, redeemForBill, refundToCards } from "../customers/gift-cards.service.js";
import { readState } from "../../database/prisma/state-store.js";

export const GATEWAY_REFUND_METHOD = "Razorpay";
const isGatewayRefundMethod = (method) => String(method || "").trim().toLowerCase() === GATEWAY_REFUND_METHOD.toLowerCase();

/**
 * Every change to a bill's money, under a per-bill lock.
 *
 * `system` and `gatewayRefunds` are for internal callers only (the payment-gateway code after it has verified a
 * payment or made a refund at Razorpay). They are never taken from a request body.
 */
export const mutateBillPayment = async ({ tenantId, invoiceId, action, payload = {}, paymentId, user, system = false, gatewayRefunds = null }) => {
  if (action === "gateway_payment" && !system) throw createHttpError({ statusCode: 403, message: "Gateway payments are recorded only by the gateway" });
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${invoiceId}`}))`;
    const bill = await tx.bill.findFirst({ where: { id: invoiceId, business: { tenantId } }, include: { business: true, items: true } });
    if (!bill) throw createHttpError({ statusCode: 404, message: "Invoice not found" });
    await lockSettlement(tx, bill.businessId);
    if (bill.status === "void") throw createHttpError({ statusCode: 409, message: "Voided invoices cannot accept financial changes" });
    const metadata = { ...(bill.metadata || {}) };
    let payments = metadata.payments || [];
    let status = bill.status;
    const at = new Date().toISOString();
    // Retry safety: a payment or refund re-sent with the same client_request_id (double tap, timeout retry) is
    // recognised under the per-bill lock and returns the bill unchanged instead of recording money twice.
    const requestId = String(payload.client_request_id ?? payload.payment_request_id ?? "").trim().slice(0, 80);
    const replayed = requestId && (
      (action === "payment" && payments.some((row) => row.client_request_id === requestId)) ||
      (action === "refund" && (metadata.refunds || []).some((row) => row.client_request_id === requestId))
    );
    if (replayed) {
      return tx.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { business: true, items: true, feedback: true } });
    }
    if (action === "gateway_payment") {
      // A payment Razorpay has confirmed (captured). Recorded once per gateway payment id.
      const gatewayPaymentId = String(payload.gateway_payment_id || "");
      if (!gatewayPaymentId) throw createHttpError({ statusCode: 400, message: "Gateway payment id is required" });
      if (payments.some((row) => row.gateway_payment_id === gatewayPaymentId)) {
        return tx.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { business: true, items: true, feedback: true } });
      }
      const amount = roundMoney(payload.amount);
      const confirmedPaid = summarizePayments(payments, bill.total).paid_amount;
      if (amount <= 0 || roundMoney(confirmedPaid + amount) > roundMoney(bill.total)) {
        throw createHttpError({ statusCode: 409, code: "GATEWAY_OVERPAYMENT", message: "The bill does not owe this amount any more" });
      }
      const shift = await ensureOpenShift(tx, bill.businessId, metadata.outlet_id || null, user);
      const pendingRow = payload.pending_payment_id
        ? payments.find((row) => row.id === payload.pending_payment_id && row.status === "pending_confirmation")
        : null;
      const confirmed = {
        method: payload.method || "UPI", amount, status: "confirmed", reference: gatewayPaymentId, gateway: "razorpay",
        gateway_payment_id: gatewayPaymentId, gateway_intent_id: payload.intent_id || null, confirmed_at: at, confirmed_by: "razorpay",
        settlement_shift_id: shift.id,
      };
      if (pendingRow && roundMoney(pendingRow.amount) === amount) {
        payments = payments.map((row) => (row.id === pendingRow.id ? { ...row, ...confirmed } : row));
      } else {
        // The customer paid a different amount than the waiting row: that row is replaced by what was really paid.
        payments = [
          ...payments.map((row) => (pendingRow && row.id === pendingRow.id ? { ...row, status: "cancelled", cancelled_at: at } : row)),
          { id: randomUUID(), ...confirmed, received_at: at, received_by: null, received_by_name: "Razorpay", client_request_id: null },
        ];
      }
    } else if (action === "payment") {
      const amount = roundMoney(payload.amount);
      const committed = payments.filter((row) => !["failed", "cancelled"].includes(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      if (amount <= 0 || amount > roundMoney(bill.total - committed)) throw createHttpError({ statusCode: 400, message: "Payment must be positive and cannot exceed the unallocated invoice balance" });
      const reference = payload.reference || payload.transaction_id;
      if (reference && payments.some((row) => row.reference === reference)) throw createHttpError({ statusCode: 409, message: "Payment reference already recorded" });
      const submittedMethod = payload.method || payload.payment_method || "Cash";
      if (typeof submittedMethod !== "string" || !submittedMethod.trim()) throw createHttpError({ statusCode: 400, message: "Payment method is required" });
      const method = submittedMethod.trim();
      const shift = await ensureOpenShift(tx, bill.businessId, metadata.outlet_id || null, user);
      if (isGiftCardMethod(method)) {
        // The card is charged now, so the payment is confirmed.
        const { card, reference } = await redeemForBill(tx, { businessId: bill.businessId, code: payload.gift_card_code, amount, billId: bill.id, actor: user, outletId: metadata.outlet_id });
        payments = [...payments, { id: randomUUID(), method: "Gift Card", amount, status: "confirmed", reference, gift_card_id: card.id, gateway: null,
          received_at: at, received_by: user?.id || null, received_by_name: user?.name || null, settlement_shift_id: shift.id, client_request_id: requestId || null }];
      } else {
        payments = [...payments, ...normalizePayments([{ ...payload, id: randomUUID(), amount, method,
          status: method.toLowerCase() === "cash" ? "confirmed" : "pending_confirmation",
          received_at: at, received_by: user?.id || null,
        }]).map((payment) => ({ ...payment, settlement_shift_id: shift.id, client_request_id: requestId || null }))];
      }
    } else if (action === "confirm") {
      const payment = payments.find((row) => row.id === paymentId);
      if (!payment) throw createHttpError({ statusCode: 404, message: "Payment not found" });
      if (!["Owner", "Manager"].includes(user?.role)) throw createHttpError({ statusCode: 403, message: "Manager approval is required for manual payment confirmation" });
      // A payment being collected through Razorpay confirms itself; confirming it by hand as well could count it twice.
      if (payment.gateway_intent_id) {
        const intent = await readState(`payment-intent:${encodeURIComponent(bill.businessId)}:${payment.gateway_intent_id}`, null, tx);
        if (intent?.status === "pending") {
          throw createHttpError({ statusCode: 409, code: "GATEWAY_PAYMENT_PENDING", message: "This payment is being collected through Razorpay and confirms automatically. Cancel the Razorpay request first to confirm it by hand." });
        }
      }
      if (["failed", "cancelled"].includes(payment.status)) throw createHttpError({ statusCode: 409, message: "Failed or cancelled payments cannot be confirmed" });
      const reference = payload.reference ?? payment.reference;
      if (typeof reference !== "string" || !reference.trim()) throw createHttpError({ statusCode: 400, message: "Verified transaction reference is required" });
      const verifiedReference = reference.trim();
      if (payments.some((row) => row.id !== paymentId && row.reference === verifiedReference)) throw createHttpError({ statusCode: 409, message: "Payment reference already recorded" });
      if (payment.status === "confirmed") {
        if (payment.reference !== verifiedReference) throw createHttpError({ statusCode: 409, message: "Confirmed payment reference cannot be changed" });
        return tx.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { business: true, items: true, feedback: true } });
      }
      const alreadyPaid = summarizePayments(payments.filter((row) => row.id !== paymentId), bill.total).paid_amount;
      if (roundMoney(alreadyPaid + Number(payment.amount)) > roundMoney(bill.total)) throw createHttpError({ statusCode: 409, message: "Confirmation would exceed the invoice total" });
      const shift = await ensureOpenShift(tx, bill.businessId, metadata.outlet_id || null, user);
      payments = payments.map((row) => row.id === paymentId ? { ...row, status: "confirmed", reference: verifiedReference, confirmed_at: at, confirmed_by: user.id, settlement_shift_id: shift.id } : row);
    } else if (action === "void_request") {
      if (!String(payload.reason || "").trim()) throw createHttpError({ statusCode: 400, message: "Void reason is required" });
      Object.assign(metadata, { void_status: "pending_approval", void_reason: String(payload.reason).trim(),
        void_requested_by: user?.id || null, void_requested_by_name: user?.name || null, void_requested_at: at });
    } else if (action === "void_approve") {
      if (!["Owner", "Manager"].includes(user?.role)) throw createHttpError({ statusCode: 403, message: "Manager approval is required for voids" });
      if (metadata.void_status !== "pending_approval") throw createHttpError({ statusCode: 409, message: "No pending void request exists" });
      const approved = payload.approved !== false;
      if (approved) {
        const paid = summarizePayments(payments, bill.total).paid_amount;
        const refunded = (metadata.refunds || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
        if (roundMoney(paid - refunded) > 0) throw createHttpError({ statusCode: 409, message: "Refund collected payments before voiding the invoice" });
        if (payments.some((row) => !["confirmed", "failed", "cancelled"].includes(row.status))) throw createHttpError({ statusCode: 409, message: "Resolve pending payments before voiding the invoice" });
        status = "void";
      }
      Object.assign(metadata, { void_status: approved ? "approved" : "rejected", void_approved_by: user.id,
        void_approved_by_name: user.name || null, void_approved_at: at });
    } else if (action === "refund") {
      if (!["Owner", "Manager"].includes(user?.role)) throw createHttpError({ statusCode: 403, message: "Manager approval is required for refunds" });
      const refunds = metadata.refunds || [];
      const paid = summarizePayments(payments, bill.total).paid_amount;
      const alreadyRefunded = refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const amount = roundMoney(payload.amount);
      if (amount <= 0 || amount > roundMoney(paid - alreadyRefunded)) throw createHttpError({ statusCode: 400, message: "Refund exceeds the remaining collected amount" });
      if (!String(payload.reason || "").trim()) throw createHttpError({ statusCode: 400, message: "Refund reason is required" });
      const methods = [...new Set(payments.filter((payment) => payment.status === "confirmed").map((payment) => payment.method))];
      const method = gatewayRefunds ? GATEWAY_REFUND_METHOD
        : payload.method && payload.method !== "Original Payment" ? payload.method : methods.length === 1 ? methods[0] : null;
      if (typeof method !== "string" || !method.trim()) throw createHttpError({ statusCode: 400, message: "Choose the refund payment method" });
      if (isGatewayRefundMethod(method) && !gatewayRefunds) {
        throw createHttpError({ statusCode: 400, code: "GATEWAY_REFUND_REQUIRED", message: "Razorpay refunds are sent to Razorpay first; use the Razorpay refund" });
      }
      // Money that came in through Razorpay goes back through Razorpay (or as cash handed over); recording a UPI/card
      // refund here would not move any money.
      const lower = method.trim().toLowerCase();
      const byMethod = payments.filter((row) => row.status === "confirmed" && String(row.method).trim().toLowerCase() === lower);
      if (!gatewayRefunds && lower !== "cash" && !isGiftCardMethod(method) && byMethod.length && byMethod.every((row) => row.gateway === "razorpay")) {
        throw createHttpError({ statusCode: 400, code: "USE_GATEWAY_REFUND", message: "This was paid through Razorpay. Refund with \"Razorpay\" to return it to the customer, or choose Cash if you hand cash back." });
      }
      const shift = await ensureOpenShift(tx, bill.businessId, metadata.outlet_id || null, user);
      if (isGiftCardMethod(method)) await refundToCards(tx, { businessId: bill.businessId, bill: { ...bill, metadata }, amount, actor: user });
      metadata.refunds = [...refunds, { id: randomUUID(), amount, method: method.trim(), reason: payload.reason, status: "approved", created_by: user.id, created_at: at, settlement_shift_id: shift.id, client_request_id: requestId || null,
        ...(gatewayRefunds ? { gateway: "razorpay", gateway_refunds: gatewayRefunds } : {}) }];
      metadata.refunded_amount = roundMoney(alreadyRefunded + amount);
      status = metadata.refunded_amount >= bill.total ? "refunded" : "partially_refunded";
    }
    Object.assign(metadata, {
      payments,
      ...summarizePayments(payments, bill.total),
      payment_gateway_status: payments.some((payment) => payment.status !== "confirmed") ? "pending_confirmation" : "confirmed",
    });
    // Paying, refunding or voiding changes what the customer earned and whether redeemed points come back.
    Object.assign(metadata, await reconcileBillCustomer(tx, { bill: { ...bill, status, metadata }, actor: user }));
    return tx.bill.update({ where: { id: bill.id }, data: { metadata, status }, include: { business: true, items: true, feedback: true } });
  });
  await admincoreChangeSyncService.notifyChange({ resource: "bills", action: action.startsWith("void_") || action === "gateway_payment" ? "updated" : action, recordId: result.id, tenantId, businessId: result.businessId });
  return serializeBill(result);
};
