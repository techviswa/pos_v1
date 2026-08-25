import prisma from "../../database/prisma/client.js";
import { isDatabaseAvailable } from "../../config/db.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import {
  billingSeedData,
  inventorySeedData,
  outletSeedData,
  productSeedData,
  userSeedData,
} from "../../shared/data/core-seed-data.js";

const DASHBOARD_CACHE_TTL_MS = 10000;
const dashboardStatsCache = new Map();

class DashboardService {
  getFallbackStats() {
    return {
      overview: {
        total_sales: billingSeedData.reduce((sum, bill) => sum + Number(bill.total || 0), 0),
        total_bills: billingSeedData.length,
        total_products: productSeedData.length,
        total_inventory_items: inventorySeedData.length,
        total_outlets: outletSeedData.length,
        total_staff: userSeedData.length,
        open_purchase_orders: 0,
        scheduled_routes: 0,
      },
      outlets: outletSeedData.map((outlet) => ({
        outlet_id: outlet.id,
        outlet_name: outlet.name,
        sales: 0,
      })),
      route_plans: [],
      restock_logs: [],
      inventoryAlerts: inventorySeedData
        .filter((item) => Number(item.stock || 0) < 10)
        .map((item) => ({
          id: item.id,
          name: item.name,
          stock: item.stock,
          unit: item.unit,
          reorderLevel: 10,
        })),
    };
  }

  async getStats({ tenantId }) {
    const cacheKey = String(tenantId || "default");
    const cached = dashboardStatsCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < DASHBOARD_CACHE_TTL_MS) {
      return cached.data;
    }

    if (!isDatabaseAvailable()) {
      const data = this.getFallbackStats();
      dashboardStatsCache.set(cacheKey, {
        timestamp: now,
        data,
      });
      return data;
    }

    try {
      const business = await ensureBusiness({ tenantId });

      const [
        bills,
        inventory,
        products,
        outlets,
        staff,
        purchaseOrderCount,
        scheduledRoutes,
        allocations,
      ] = await Promise.all([
        prisma.bill.findMany({
          where: { businessId: business.id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.inventoryItem.findMany({
          where: { businessId: business.id },
          orderBy: { createdAt: "asc" },
        }),
        prisma.product.findMany({
          where: { businessId: business.id },
        }),
        prisma.outlet.findMany({
          where: { businessId: business.id },
          orderBy: { createdAt: "asc" },
        }),
        prisma.user.findMany({
          where: { businessId: business.id },
        }),
        prisma.purchaseOrder.count({
          where: {
            businessId: business.id,
            status: { in: ["pending", "approved"] },
          },
        }),
        prisma.routePlan.findMany({
          where: {
            businessId: business.id,
            status: { in: ["planned", "in-transit"] },
          },
          include: {
            stops: true,
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.allocation.findMany({
          where: { businessId: business.id },
          include: { outlet: true, routePlan: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

      const data = {
        overview: {
          total_sales: bills.reduce((sum, bill) => sum + Number(bill.total || 0), 0),
          total_bills: bills.length,
          total_products: products.length,
          total_inventory_items: inventory.length,
          total_outlets: outlets.length,
          total_staff: staff.length,
          open_purchase_orders: purchaseOrderCount,
          scheduled_routes: scheduledRoutes.length,
        },
        outlets: outlets.map((outlet) => ({
          outlet_id: outlet.id,
          outlet_name: outlet.name,
          sales: 0,
        })),
        route_plans: scheduledRoutes.map((routePlan) => ({
          id: routePlan.id,
          route_name: routePlan.routeName,
          status: routePlan.status,
          dispatch_date: routePlan.dispatchDate ? routePlan.dispatchDate.toISOString() : null,
          stops: routePlan.stops.map((stop) => ({
            outlet_id: stop.outletId,
          })),
        })),
        restock_logs: allocations.map((allocation) => ({
          id: allocation.id,
          outlet_name: allocation.outlet?.name || "Outlet",
          quantity: Array.isArray(allocation.items) ? allocation.items.length : 0,
          route_name: allocation.routePlan?.routeName || "Direct Dispatch",
        })),
        inventoryAlerts: inventory
          .filter((item) => Number(item.stock || 0) < Number(item.reorderLevel || 0))
          .map((item) => ({
            id: item.id,
            name: item.name,
            stock: item.stock,
            unit: item.unit,
            reorderLevel: item.reorderLevel,
          })),
      };

      dashboardStatsCache.set(cacheKey, {
        timestamp: now,
        data,
      });

      return data;
    } catch (error) {
      if (error?.code !== "P2021") {
        throw error;
      }

      const data = this.getFallbackStats();
      dashboardStatsCache.set(cacheKey, {
        timestamp: now,
        data,
      });
      return data;
    }
  }
}

export const dashboardService = new DashboardService();
