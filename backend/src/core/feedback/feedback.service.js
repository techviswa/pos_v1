import env from "../../config/env.js";
import prisma from "../../database/prisma/client.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";

class FeedbackService {
  async listFeedback() {
    const business = await ensureBusiness({
      tenantId: env.defaultTenantId,
      businessId: env.defaultBusinessId,
    });
    const items = await prisma.feedback.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
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

  async getFeedbackForm({ token }) {
    const business = await ensureBusiness({
      tenantId: env.defaultTenantId,
      businessId: env.defaultBusinessId,
    });
    const item = await prisma.feedback.findFirst({
      where: {
        businessId: business.id,
        token,
      },
      include: {
        bill: true,
      },
    });

    return {
      token,
      outlet_name: "Main Outlet",
      bill_id: item?.billId || "bill_1001",
      questions: ["Rate your experience", "Share your feedback"],
    };
  }

  async submitFeedbackForm({ token, payload }) {
    const business = await ensureBusiness({
      tenantId: env.defaultTenantId,
      businessId: env.defaultBusinessId,
    });

    const feedback = await prisma.feedback.upsert({
      where: { token },
      update: {
        customerName: payload.customer_name || payload.customerName || null,
        rating: payload.rating !== undefined ? Number(payload.rating) : null,
        comment: payload.comment || "",
      },
      create: {
        businessId: business.id,
        token,
        customerName: payload.customer_name || payload.customerName || null,
        rating: payload.rating !== undefined ? Number(payload.rating) : null,
        comment: payload.comment || "",
      },
    });

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
