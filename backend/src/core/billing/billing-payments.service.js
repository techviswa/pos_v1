import { randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { serializeBill } from "../../database/prisma/helpers.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { normalizePayments, summarizePayments, roundMoney } from "./billing-depth.utils.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

export const mutateBillPayment = async ({ tenantId, invoiceId, action, payload = {}, paymentId, user }) => {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${invoiceId}`}))`;
    const bill = await tx.bill.findFirst({ where: { id: invoiceId, business: { tenantId } }, include: { business: true, items: true } });
    if (!bill) throw createHttpError({ statusCode: 404, message: "Invoice not found" });
    if (bill.status === "void") throw createHttpError({ statusCode: 409, message: "Voided invoices cannot accept financial changes" });
    const metadata = { ...(bill.metadata || {}) };
    let payments = metadata.payments || [];
    let status = bill.status;
    const at = new Date().toISOString();
    if (action === "payment") {
      const amount = roundMoney(payload.amount);
      const committed = payments.filter((row) => !["failed", "cancelled"].includes(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0);
      if (amount <= 0 || amount > roundMoney(bill.total - committed)) throw createHttpError({ statusCode: 400, message: "Payment must be positive and cannot exceed the unallocated invoice balance" });
      const reference = payload.reference || payload.transaction_id;
      if (reference && payments.some((row) => row.reference === reference)) throw createHttpError({ statusCode: 409, message: "Payment reference already recorded" });
      const submittedMethod = payload.method || payload.payment_method || "Cash";
      if (typeof submittedMethod !== "string" || !submittedMethod.trim()) throw createHttpError({ statusCode: 400, message: "Payment method is required" });
      const method = submittedMethod.trim();
      payments = [...payments, ...normalizePayments([{ ...payload, id: randomUUID(), amount, method,
        status: method.toLowerCase() === "cash" ? "confirmed" : "pending_confirmation",
        received_at: at, received_by: user?.id || null,
      }])];
    } else if (action === "confirm") {
      const payment = payments.find((row) => row.id === paymentId);
      if (!payment) throw createHttpError({ statusCode: 404, message: "Payment not found" });
      if (!["Owner", "Manager"].includes(user?.role)) throw createHttpError({ statusCode: 403, message: "Manager approval is required for manual payment confirmation" });
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
      payments = payments.map((row) => row.id === paymentId ? { ...row, status: "confirmed", reference: verifiedReference, confirmed_at: at, confirmed_by: user.id } : row);
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
      metadata.refunds = [...refunds, { id: randomUUID(), amount, method: payload.method || "Original Payment", reason: payload.reason, status: "approved", created_by: user.id, created_at: at }];
      metadata.refunded_amount = roundMoney(alreadyRefunded + amount);
      status = metadata.refunded_amount >= bill.total ? "refunded" : "partially_refunded";
    }
    Object.assign(metadata, {
      payments,
      ...summarizePayments(payments, bill.total),
      payment_gateway_status: payments.some((payment) => payment.status !== "confirmed") ? "pending_confirmation" : "confirmed",
    });
    return tx.bill.update({ where: { id: bill.id }, data: { metadata, status }, include: { business: true, items: true, feedback: true } });
  });
  await admincoreChangeSyncService.notifyChange({ resource: "bills", action: action.startsWith("void_") ? "updated" : action, recordId: result.id, tenantId, businessId: result.businessId });
  return serializeBill(result);
};
