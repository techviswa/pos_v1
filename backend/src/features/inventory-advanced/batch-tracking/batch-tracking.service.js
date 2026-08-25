import prisma from "../../../database/prisma/client.js";
import {
  ensureBusiness,
  serializeBatch,
} from "../../../database/prisma/helpers.js";

class BatchTrackingService {
  async listBatches({ tenantId }) {
    const business = await ensureBusiness({ tenantId });
    const items = await prisma.batch.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
    });

    return {
      tenantId,
      items: items.map((item) => serializeBatch(item, tenantId)),
    };
  }

  async createBatch({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const batch = await prisma.batch.create({
      data: {
        businessId: business.id,
        sku: payload.sku || "SKU",
        batchNo: payload.batchNo || payload.batch_no || `BATCH-${Date.now()}`,
        expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : new Date(),
      },
    });

    return serializeBatch(batch, tenantId);
  }
}

export const batchTrackingService = new BatchTrackingService();
