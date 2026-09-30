import prisma from "../../../database/prisma/client.js";
import {
  ensureBusiness,
  serializeAllocation,
} from "../../../database/prisma/helpers.js";
import { logisticsWorkflowService } from "../../../services/workflows/logistics-workflow.service.js";
import { assertOwnedIds } from "../../../database/prisma/scope.js";
import { createNotFoundError } from "../../../shared/utils/http-error.js";

// Every id an allocation points at must be this business's own.
const assertAllocationRefs = async (businessId, { outletId, purchaseOrderId, routePlanId }) => {
  await assertOwnedIds({ kind: "outlet", ids: [outletId], businessId });
  await assertOwnedIds({ kind: "purchaseOrder", ids: [purchaseOrderId], businessId });
  await assertOwnedIds({ kind: "routePlan", ids: [routePlanId], businessId });
};

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
    await assertAllocationRefs(business.id, {
      outletId: payload.outletId || payload.outlet_id,
      purchaseOrderId: payload.purchaseOrderId || payload.purchase_order_id,
      routePlanId: payload.routePlanId || payload.route_plan_id,
    });
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

    await assertAllocationRefs(business.id, {
      outletId: payload.outletId ?? payload.outlet_id,
      purchaseOrderId: payload.purchaseOrderId ?? payload.purchase_order_id,
      routePlanId: payload.routePlanId ?? payload.route_plan_id,
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
      const claimed = await tx.allocation.updateMany({
        where: { id: allocationId, businessId: business.id },
        data: { status: "dispatched" },
      });
      if (!claimed.count) throw createNotFoundError("Allocation", { allocationId });
      const dispatchedAllocation = await tx.allocation.findFirstOrThrow({ where: { id: allocationId, businessId: business.id } });

      await logisticsWorkflowService.handleAllocationDispatched({
        tenantId,
        businessId: business.id,
        allocationId,
        tx,
      });

      return tx.allocation.findFirstOrThrow({
        where: { id: dispatchedAllocation.id, businessId: business.id },
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
