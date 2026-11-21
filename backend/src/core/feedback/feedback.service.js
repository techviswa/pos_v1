import prisma from "../../database/prisma/client.js";
import { createHttpError, createNotFoundError } from "../../shared/utils/http-error.js";
import { verifyFeedbackToken } from "./feedback-token.js";
import { bindTenantScope } from "../../database/prisma/tenant-context.js";

const MAX_COMMENT_LENGTH = 1000;
const MAX_NAME_LENGTH = 100;

const invalidLink = () => createNotFoundError("Feedback link");

class FeedbackService {
  /** Feedback belongs to the signed-in business only. */
  async listFeedback({ businessId, outletIds = null, from, to }) {
    for (const value of [from, to]) if (value && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw createHttpError({ statusCode: 400, message: "Use valid feedback dates (YYYY-MM-DD)" });
    if (from && to && from > to) throw createHttpError({ statusCode: 400, message: "Start date must not follow end date" });
    const where = { businessId,
      ...((from || to) ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86400000) } : {}) } } : {}),
      ...(outletIds ? { bill: { OR: [{ order: { outletId: { in: outletIds } } }, ...outletIds.map((id) => ({ metadata: { path: ["outlet_id"], equals: id } }))] } } : {}),
    };
    const [items, total, ratings] = await Promise.all([prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
    }), prisma.feedback.count({ where }), prisma.feedback.aggregate({ where: { ...where, rating: { gte: 1, lte: 5 } }, _avg: { rating: true }, _count: { rating: true } })]);

    return {
      items: items.map((item) => ({
        id: item.id,
        customer_name: item.customerName || "Guest",
        rating: item.rating,
        comment: item.comment || "",
        created_at: item.createdAt.toISOString(),
      })),
      summary: {
        total_feedback: total,
        rated_feedback: ratings._count.rating,
        average_rating: ratings._avg.rating,
        displayed_feedback: items.length,
        has_more: total > items.length,
      },
    };
  }

  async resolveBill(token) {
    const billId = verifyFeedbackToken(token);
    if (!billId) throw invalidLink();
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      select: { id: true, businessId: true, business: { select: { name: true, tenantId: true } } },
    });
    if (!bill) throw invalidLink();
    bindTenantScope({ businessId: bill.businessId, tenantId: bill.business.tenantId });
    return bill;
  }

  async getFeedbackForm({ token }) {
    const bill = await this.resolveBill(token);
    const existing = await prisma.feedback.findUnique({ where: { token }, select: { id: true } });

    return {
      token,
      outlet_name: bill.business?.name || "",
      bill_id: bill.id,
      already_submitted: Boolean(existing),
      feedback_received: Boolean(existing),
      questions: ["Rate your experience", "Share your feedback"],
    };
  }

  async submitFeedbackForm({ token, payload = {} }) {
    const bill = await this.resolveBill(token);

    const rating = payload.rating === undefined || payload.rating === null || payload.rating === "" ? null : Number(payload.rating);
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw createHttpError({ statusCode: 400, code: "FEEDBACK_RATING_INVALID", message: "rating must be a whole number from 1 to 5" });
    }
    const customerName = String(payload.customer_name ?? payload.customerName ?? "").trim().slice(0, MAX_NAME_LENGTH) || null;
    const comment = String(payload.comment ?? "").trim();
    if (comment.length > MAX_COMMENT_LENGTH) {
      throw createHttpError({ statusCode: 400, code: "FEEDBACK_COMMENT_TOO_LONG", message: `comment must be at most ${MAX_COMMENT_LENGTH} characters` });
    }

    // One submission per issued link. The tenant comes from the bill, never from a default or from the caller.
    let feedback;
    try {
      feedback = await prisma.feedback.create({
        data: { businessId: bill.businessId, billId: bill.id, token, customerName, rating, comment },
      });
    } catch (error) {
      if (error?.code === "P2002") {
        throw createHttpError({ statusCode: 409, code: "FEEDBACK_ALREADY_SUBMITTED", message: "Feedback was already submitted for this bill" });
      }
      throw error;
    }

    return {
      token,
      submitted: true,
      id: feedback.id,
      customer_name: feedback.customerName,
      rating: feedback.rating,
      comment: feedback.comment,
    };
  }
}

export const feedbackService = new FeedbackService();
