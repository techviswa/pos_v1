import prisma from "../../../database/prisma/client.js";
import {
  ensureBusiness,
  serializePurchaseOrder,
} from "../../../database/prisma/helpers.js";
import { logisticsWorkflowService } from "../../../services/workflows/logistics-workflow.service.js";

class OutletPurchaseOrdersService {
  async listPurchaseOrders({ tenantId }) {
    const business = await ensureBusiness({ tenantId });
    const items = await prisma.purchaseOrder.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
    });

    return {
      tenantId,
      items: items.map((item) => serializePurchaseOrder(item, tenantId)),
    };
  }

  async getPurchaseOrderById({ tenantId, purchaseOrderId }) {
    const business = await ensureBusiness({ tenantId });
    const item = await prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        businessId: business.id,
      },
    });

    return {
      tenantId,
      item: item ? serializePurchaseOrder(item, tenantId) : null,
    };
  }

  async createPurchaseOrder({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        businessId: business.id,
        outletId: payload.outletId || payload.outlet_id,
        requestedById: payload.requestedById || payload.requested_by_id || null,
        priority: payload.priority || null,
        requiredBy: payload.requiredBy ? new Date(payload.requiredBy) : null,
        notes: payload.notes || "",
        status: payload.status || "pending",
        items: payload.items || [],
      },
    });

    return serializePurchaseOrder(purchaseOrder, tenantId);
  }

  async updatePurchaseOrder({ tenantId, purchaseOrderId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const currentItem = await prisma.purchaseOrder.findFirstOrThrow({
      where: {
        id: purchaseOrderId,
        businessId: business.id,
      },
    });

    const purchaseOrder = await prisma.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        outletId: payload.outletId ?? payload.outlet_id ?? currentItem.outletId,
        requestedById: payload.requestedById ?? payload.requested_by_id ?? currentItem.requestedById,
        priority: payload.priority ?? currentItem.priority,
        requiredBy:
          payload.requiredBy !== undefined
            ? payload.requiredBy
              ? new Date(payload.requiredBy)
              : null
            : currentItem.requiredBy,
        notes: payload.notes ?? currentItem.notes,
        status: payload.status ?? currentItem.status,
        items: payload.items ?? currentItem.items,
      },
    });

    return serializePurchaseOrder(purchaseOrder, tenantId);
  }

  async approvePurchaseOrder({ tenantId, purchaseOrderId }) {
    const business = await ensureBusiness({ tenantId });
    const purchaseOrder = await prisma.$transaction(async (tx) => {
      const approvedPurchaseOrder = await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: "approved" },
      });

      await logisticsWorkflowService.handlePurchaseOrderApproved({
        tenantId,
        businessId: business.id,
        purchaseOrderId,
        tx,
      });

      return approvedPurchaseOrder;
    });

    return serializePurchaseOrder(purchaseOrder, tenantId);
  }

  async rejectPurchaseOrder({ tenantId, purchaseOrderId }) {
    return this.updatePurchaseOrder({
      tenantId,
      purchaseOrderId,
      payload: { status: "rejected" },
    });
  }
}

export const outletPurchaseOrdersService = new OutletPurchaseOrdersService();
