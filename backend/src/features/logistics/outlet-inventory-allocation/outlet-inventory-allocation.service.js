import prisma from "../../../database/prisma/client.js";
import {
  ensureBusiness,
  serializeAllocation,
} from "../../../database/prisma/helpers.js";
import { logisticsWorkflowService } from "../../../services/workflows/logistics-workflow.service.js";

class OutletInventoryAllocationService {
  async listAllocations({ tenantId }) {
    const business = await ensureBusiness({ tenantId });
    const items = await prisma.allocation.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: "desc" },
    });

    return {
      tenantId,
      items: items.map((item) => serializeAllocation(item, tenantId)),
    };
  }

  async getAllocationById({ tenantId, allocationId }) {
    const business = await ensureBusiness({ tenantId });
    const item = await prisma.allocation.findFirst({
      where: {
        id: allocationId,
        businessId: business.id,
      },
    });

    return {
      tenantId,
      item: item ? serializeAllocation(item, tenantId) : null,
    };
  }

  async createAllocation({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const allocation = await prisma.allocation.create({
      data: {
        businessId: business.id,
        outletId: payload.outletId || payload.outlet_id,
        purchaseOrderId: payload.purchaseOrderId || payload.purchase_order_id || null,
        routePlanId: payload.routePlanId || payload.route_plan_id || null,
        sourceLocation: payload.sourceLocation || payload.source_location || "central-kitchen",
        status: payload.status || "draft",
        items: payload.items || [],
      },
    });

    return serializeAllocation(allocation, tenantId);
  }

  async updateAllocation({ tenantId, allocationId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const currentAllocation = await prisma.allocation.findFirstOrThrow({
      where: {
        id: allocationId,
        businessId: business.id,
      },
    });

    const allocation = await prisma.allocation.update({
      where: { id: allocationId },
      data: {
        outletId: payload.outletId ?? payload.outlet_id ?? currentAllocation.outletId,
        purchaseOrderId:
          payload.purchaseOrderId ?? payload.purchase_order_id ?? currentAllocation.purchaseOrderId,
        routePlanId: payload.routePlanId ?? payload.route_plan_id ?? currentAllocation.routePlanId,
        sourceLocation:
          payload.sourceLocation ?? payload.source_location ?? currentAllocation.sourceLocation,
        status: payload.status ?? currentAllocation.status,
        items: payload.items ?? currentAllocation.items,
      },
    });

    return serializeAllocation(allocation, tenantId);
  }

  async dispatchAllocation({ tenantId, allocationId }) {
    const business = await ensureBusiness({ tenantId });
    const allocation = await prisma.$transaction(async (tx) => {
      const dispatchedAllocation = await tx.allocation.update({
        where: { id: allocationId },
        data: { status: "dispatched" },
      });

      await logisticsWorkflowService.handleAllocationDispatched({
        tenantId,
        businessId: business.id,
        allocationId,
        tx,
      });

      return tx.allocation.findUniqueOrThrow({
        where: { id: dispatchedAllocation.id },
      });
    });

    return serializeAllocation(allocation, tenantId);
  }

  async receiveAllocation({ tenantId, allocationId }) {
    return this.updateAllocation({
      tenantId,
      allocationId,
      payload: { status: "received" },
    });
  }
}

export const outletInventoryAllocationService = new OutletInventoryAllocationService();
