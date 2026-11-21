import prisma from "../../../database/prisma/client.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { qrCheckoutService } from "./qr-checkout.service.js";
import { feedbackService } from "../../../core/feedback/feedback.service.js";
import { signFeedbackToken } from "../../../core/feedback/feedback-token.js";
import { summarizePayments } from "../../../core/billing/billing-depth.utils.js";
import { publishChange } from "../../../services/realtime/realtime.service.js";
import { qrBillScope } from "./qr-bill-scope.js";

export const FEEDBACK_TOPICS = ["food", "speed", "staff", "cleanliness", "value"];
const fail = (statusCode, message) => { throw createHttpError({ statusCode, message }); };
export const reviewKey = (businessId, feedbackId) => `qr-review:${businessId}:${feedbackId}`;
const eligible = (bill) => bill && !["void", "refunded"].includes(bill.status) && summarizePayments(bill.metadata?.payments || [], bill.total).payment_status === "paid";
const rating = (value, required = false) => {
  if ((value === undefined || value === null || value === "") && !required) return null;
  if (!Number.isInteger(value) || value < 1 || value > 5) fail(400, "Ratings must be whole numbers from 1 to 5");
  return value;
};

export const qrExperienceService = {
  async form({ trackingToken }) {
    const order = await qrCheckoutService.order(trackingToken);
    const existing = order.bill ? await prisma.feedback.findFirst({ where: { businessId: order.businessId, billId: order.bill.id }, select: { id: true } }) : null;
    const paid = order.bill && (order.checkoutBills || [order.bill]).every(eligible);
    return { eligible: Boolean(paid), already_submitted: Boolean(existing), topics: FEEDBACK_TOPICS,
      message: existing ? "Thank you. Feedback has already been received for this bill." : paid ? "How was your visit?" : "Feedback opens after all final invoices for this order are paid." };
  },
  async submit({ trackingToken, payload = {} }) {
    const order = await qrCheckoutService.order(trackingToken);
    if (!order.bill) fail(409, "Feedback opens after the final bill is paid");
    const overall = rating(payload.rating, true), food = rating(payload.food_rating), service = rating(payload.service_rating);
    if (payload.comment !== undefined && typeof payload.comment !== "string") fail(400, "Feedback must be text");
    const comment = (payload.comment || "").trim();
    if (comment.length > 1000) fail(400, "Keep feedback within 1000 characters");
    const topics = payload.topics || [];
    if (!Array.isArray(topics) || topics.length > 5 || topics.some((topic) => !FEEDBACK_TOPICS.includes(topic))) fail(400, "Choose valid feedback topics");
    return prisma.$transaction(async (tx) => {
      const billIds = (order.checkoutBills || [order.bill]).map((bill) => bill.id).sort();
      for (const id of billIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${id}`}))`;
      const existing = await tx.feedback.findFirst({ where: { businessId: order.businessId, billId: order.bill.id }, select: { id: true } });
      if (existing) return { submitted: true, duplicate: true };
      const bill = await tx.bill.findFirst({ where: { id: order.bill.id, businessId: order.businessId } });
      const allBills = await tx.bill.findMany({ where: { id: { in: billIds }, businessId: order.businessId } });
      if (allBills.length !== billIds.length || !allBills.every(eligible)) fail(409, "Feedback opens after all final invoices for this order are paid");
      const feedback = await feedbackService.submitFeedbackForm({ token: signFeedbackToken(bill.id), payload: { rating: overall, comment } });
      const data = { business_id: order.businessId, feedback_id: feedback.id, bill_id: bill.id, source: "qr", food_rating: food, service_rating: service, topics: [...new Set(topics)], status: "new", internal_note: "", history: [] };
      await tx.stateDocument.create({ data: { key: reviewKey(order.businessId, feedback.id), data } });
      await publishChange({ businessId: order.businessId, resource: "qr_feedback", action: "created", recordId: feedback.id, outletId: order.outletId }, { tx });
      return { submitted: true, duplicate: false };
    });
  },
  async followUp({ businessId, outletIds, feedbackId, payload = {}, user }) {
    if (!["new", "reviewing", "resolved"].includes(payload.status)) fail(400, "Choose a valid review status");
    if (payload.internal_note !== undefined && (typeof payload.internal_note !== "string" || payload.internal_note.length > 500)) fail(400, "Keep the internal note within 500 characters");
    const feedback = await prisma.feedback.findFirst({ where: { id: feedbackId, businessId, bill: qrBillScope(outletIds) }, select: { id: true, billId: true } });
    if (!feedback) fail(404, "Feedback not found");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qr-review:${feedback.id}`}))`;
      const key = reviewKey(businessId, feedback.id), existing = await tx.stateDocument.findUnique({ where: { key } });
      const note = payload.internal_note === undefined ? existing?.data?.internal_note || "" : payload.internal_note.trim();
      const data = { ...(existing?.data || {}), business_id: businessId, feedback_id: feedback.id, bill_id: feedback.billId,
        status: payload.status, internal_note: note, history: [...(existing?.data?.history || []).slice(-49), { status: payload.status, at: new Date().toISOString(), actor_id: user?.id || null, actor_name: user?.name || null }] };
      await tx.stateDocument.upsert({ where: { key }, create: { key, data }, update: { data } });
      await publishChange({ businessId, resource: "qr_feedback", action: "reviewed", recordId: feedback.id }, { tx });
      return { updated: true, status: data.status };
    });
  },
};
