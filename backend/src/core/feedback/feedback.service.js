import prisma from "../../database/prisma/client.js";
import { createHttpError, createNotFoundError } from "../../shared/utils/http-error.js";
import { verifyFeedbackToken } from "./feedback-token.js";

const MAX_COMMENT_LENGTH = 1000;
const MAX_NAME_LENGTH = 100;

const invalidLink = () => createNotFoundError("Feedback link");

class FeedbackService {
  /** Feedback belongs to the signed-in business only. */
  async listFeedback({ businessId }) {
    const items = await prisma.feedback.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const totalRating = items.reduce((sum, item) => sum + Number(item.rating || 0), 0);

    return {
      items: items.map((item) => ({
        id: item.id,
        customer_name: item.customerName || "Guest",
        rating: item.rating,
        comment: item.comment || "",
        created_at: item.createdAt.toISOString(),
      })),
      summary: {
        total_feedback: items.length,
        average_rating: items.length ? totalRating / items.length : 0,
      },
    };
  }

  async resolveBill(token) {
    const billId = verifyFeedbackToken(token);
    if (!billId) throw invalidLink();
    const bill = await prisma.bill.findUnique({
      where: { id: billId },
      select: { id: true, businessId: true, business: { select: { name: true } } },
    });
    if (!bill) throw invalidLink();
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
