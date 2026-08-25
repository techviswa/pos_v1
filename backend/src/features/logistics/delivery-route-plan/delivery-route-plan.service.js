import prisma from "../../../database/prisma/client.js";
import {
  ensureBusiness,
  serializeRoutePlan,
} from "../../../database/prisma/helpers.js";
import { logisticsWorkflowService } from "../../../services/workflows/logistics-workflow.service.js";

class DeliveryRoutePlanService {
  async listRoutePlans({ tenantId }) {
    const business = await ensureBusiness({ tenantId });
    const items = await prisma.routePlan.findMany({
      where: { businessId: business.id },
      include: { stops: true },
      orderBy: { createdAt: "desc" },
    });

    return {
      tenantId,
      items: items.map((item) => serializeRoutePlan(item, tenantId)),
    };
  }

  async getRoutePlanById({ tenantId, routePlanId }) {
    const business = await ensureBusiness({ tenantId });
    const item = await prisma.routePlan.findFirst({
      where: {
        id: routePlanId,
        businessId: business.id,
      },
      include: { stops: true },
    });

    return {
      tenantId,
      item: item ? serializeRoutePlan(item, tenantId) : null,
    };
  }

  async createRoutePlan({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const routePlan = await prisma.routePlan.create({
      data: {
        businessId: business.id,
        routeName: payload.routeName || payload.route_name || "New Route",
        dispatchDate: payload.dispatchDate ? new Date(payload.dispatchDate) : null,
        driverName: payload.driverName || payload.driver_name || "",
        vehicleNumber: payload.vehicleNumber || payload.vehicle_number || "",
        status: payload.status || "planned",
        stops: {
          create: (payload.stops || []).map((stop, index) => ({
            outletId: stop.outletId || stop.outlet_id,
            sequence: Number(stop.sequence || index + 1),
            eta: stop.eta || null,
          })),
        },
      },
      include: { stops: true },
    });

    return serializeRoutePlan(routePlan, tenantId);
  }

  async updateRoutePlan({ tenantId, routePlanId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const currentRoutePlan = await prisma.routePlan.findFirstOrThrow({
      where: {
        id: routePlanId,
        businessId: business.id,
      },
      include: { stops: true },
    });

    await prisma.routePlan.update({
      where: { id: routePlanId },
      data: {
        routeName: payload.routeName ?? payload.route_name ?? currentRoutePlan.routeName,
        dispatchDate:
          payload.dispatchDate !== undefined
            ? payload.dispatchDate
              ? new Date(payload.dispatchDate)
              : null
            : currentRoutePlan.dispatchDate,
        driverName: payload.driverName ?? payload.driver_name ?? currentRoutePlan.driverName,
        vehicleNumber:
          payload.vehicleNumber ?? payload.vehicle_number ?? currentRoutePlan.vehicleNumber,
        status: payload.status ?? currentRoutePlan.status,
      },
    });

    if (payload.stops !== undefined) {
      await prisma.routeStop.deleteMany({
        where: { routePlanId },
      });

      if ((payload.stops || []).length) {
        await prisma.routeStop.createMany({
          data: payload.stops.map((stop, index) => ({
            routePlanId,
            outletId: stop.outletId || stop.outlet_id,
            sequence: Number(stop.sequence || index + 1),
            eta: stop.eta || null,
          })),
        });
      }
    }

    const routePlan = await prisma.routePlan.findUniqueOrThrow({
      where: { id: routePlanId },
      include: { stops: true },
    });

    return serializeRoutePlan(routePlan, tenantId);
  }

  async startRoutePlan({ tenantId, routePlanId }) {
    const business = await ensureBusiness({ tenantId });
    const routePlan = await prisma.$transaction(async (tx) => {
      await tx.routePlan.update({
        where: { id: routePlanId },
        data: { status: "in-transit" },
      });

      await logisticsWorkflowService.handleRouteStarted({
        businessId: business.id,
        routePlanId,
        tx,
      });

      return tx.routePlan.findUniqueOrThrow({
        where: { id: routePlanId },
        include: { stops: true },
      });
    });

    return serializeRoutePlan(routePlan, tenantId);
  }

  async completeRoutePlan({ tenantId, routePlanId }) {
    const business = await ensureBusiness({ tenantId });
    const routePlan = await prisma.$transaction(async (tx) => {
      await tx.routePlan.update({
        where: { id: routePlanId },
        data: { status: "completed" },
      });

      await logisticsWorkflowService.handleRouteCompleted({
        businessId: business.id,
        routePlanId,
        tx,
      });

      return tx.routePlan.findUniqueOrThrow({
        where: { id: routePlanId },
        include: { stops: true },
      });
    });

    return serializeRoutePlan(routePlan, tenantId);
  }
}

export const deliveryRoutePlanService = new DeliveryRoutePlanService();
