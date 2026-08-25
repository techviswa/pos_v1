import prisma from "../../database/prisma/client.js";
import { featureToggleService } from "../featureToggleService.js";
import { FEATURE_KEYS } from "../../shared/constants/module.constants.js";

class LogisticsWorkflowService {
  async ensureAllocationForPurchaseOrder({ tenantId, businessId, purchaseOrderId, tx = prisma }) {
    const allocationEnabled = await featureToggleService.isFeatureEnabled(
      FEATURE_KEYS.OUTLET_INVENTORY_ALLOCATION,
      businessId,
    );

    if (!allocationEnabled || !purchaseOrderId) {
      return null;
    }

    const existingAllocation = await tx.allocation.findFirst({
      where: {
        businessId,
        purchaseOrderId,
      },
    });

    if (existingAllocation) {
      return existingAllocation;
    }

    const purchaseOrder = await tx.purchaseOrder.findFirstOrThrow({
      where: {
        id: purchaseOrderId,
        businessId,
      },
    });

    return tx.allocation.create({
      data: {
        businessId,
        outletId: purchaseOrder.outletId,
        purchaseOrderId,
        sourceLocation: "central-kitchen",
        status: "draft",
        items: purchaseOrder.items,
      },
    });
  }

  async ensureRouteForAllocation({ tenantId, businessId, allocationId, tx = prisma }) {
    const routeEnabled = await featureToggleService.isFeatureEnabled(
      FEATURE_KEYS.DELIVERY_ROUTE_PLAN,
      businessId,
    );

    if (!routeEnabled || !allocationId) {
      return null;
    }

    const allocation = await tx.allocation.findFirstOrThrow({
      where: {
        id: allocationId,
        businessId,
      },
      include: {
        outlet: true,
        routePlan: true,
      },
    });

    if (allocation.routePlanId && allocation.routePlan) {
      return allocation.routePlan;
    }

    const routePlan = await tx.routePlan.create({
      data: {
        businessId,
        routeName: `Dispatch for ${allocation.outlet?.name || "Outlet"}`,
        dispatchDate: new Date(),
        driverName: "",
        vehicleNumber: "",
        status: "planned",
        stops: {
          create: [
            {
              outletId: allocation.outletId,
              sequence: 1,
              eta: null,
            },
          ],
        },
      },
    });

    await tx.allocation.update({
      where: { id: allocationId },
      data: { routePlanId: routePlan.id },
    });

    return routePlan;
  }

  async handlePurchaseOrderApproved({ tenantId, businessId, purchaseOrderId, tx = prisma }) {
    return this.ensureAllocationForPurchaseOrder({
      tenantId,
      businessId,
      purchaseOrderId,
      tx,
    });
  }

  async handleAllocationDispatched({ tenantId, businessId, allocationId, tx = prisma }) {
    return this.ensureRouteForAllocation({
      tenantId,
      businessId,
      allocationId,
      tx,
    });
  }

  async handleRouteStarted({ businessId, routePlanId, tx = prisma }) {
    await tx.allocation.updateMany({
      where: {
        businessId,
        routePlanId,
      },
      data: {
        status: "in-transit",
      },
    });
  }

  async handleRouteCompleted({ businessId, routePlanId, tx = prisma }) {
    await tx.allocation.updateMany({
      where: {
        businessId,
        routePlanId,
        status: {
          in: ["dispatched", "in-transit"],
        },
      },
      data: {
        status: "delivered",
      },
    });
  }
}

export const logisticsWorkflowService = new LogisticsWorkflowService();
