import prisma from "../../database/prisma/client.js";
import { reportOutlets } from './outlet-report-policy.js';
import { isDatabaseAvailable } from "../../config/db.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import { assertOwnedIds } from '../../database/prisma/scope.js';
import { createHttpError } from '../../shared/utils/http-error.js';
import { Prisma } from "@prisma/client";
import { billFromSql, billOutletSql, billRevenueSql, isRevenueBillSql } from "../billing/bill-analytics.sql.js";

const DASHBOARD_CACHE_TTL_MS = 10000;
const dashboardStatsCache = new Map();

class DashboardService {
  async getStats({ tenantId, outletId = null }) {
    if (!isDatabaseAvailable()) throw createHttpError({ statusCode: 503, code: 'DASHBOARD_UNAVAILABLE', message: 'Dashboard data is unavailable. Retry after the database reconnects.' });
    const cacheKey = JSON.stringify([tenantId, outletId]);
    const cached = dashboardStatsCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < DASHBOARD_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const business = await ensureBusiness({ tenantId });
      if (outletId) await assertOwnedIds({ kind: 'outlet', ids: [outletId], businessId: business.id });
      const routeWhere = { businessId: business.id, status: { in: ['planned', 'in-transit'] }, ...(outletId ? { stops: { some: { outletId } } } : {}) };
      const allocationWhere = { businessId: business.id, ...(outletId ? { outletId } : {}) };

      const [
        bills,
        inventory,
        products,
        outlets,
        staff,
        purchaseOrderCount,
        scheduledRoutes,
        allocations,
        routeCount,
        allocationCount,
      ] = await Promise.all([
        // All-time totals per outlet, summed in PostgreSQL (a year of bills no longer travels to the server).
        prisma.$queryRaw(Prisma.sql`SELECT ${billOutletSql} AS outlet_id,
            COUNT(*) FILTER (WHERE ${isRevenueBillSql})::int AS revenue_bills,
            COALESCE(SUM(${billRevenueSql}) FILTER (WHERE ${isRevenueBillSql}), 0)::float8 AS revenue
          FROM ${billFromSql} WHERE b."businessId" = ${business.id}
          ${outletId ? Prisma.sql`AND ${billOutletSql} = ${outletId}` : Prisma.empty}
          GROUP BY 1`),
        prisma.inventoryItem.findMany({
          where: { businessId: business.id, ...(outletId ? { outletLinks: { some: { outletId, enabled: true } } } : {}) },
          ...(outletId ? { include: { outletLinks: { where: { outletId, enabled: true } } } } : {}),
          orderBy: { createdAt: "asc" },
        }),
        prisma.product.findMany({
          where: { businessId: business.id, ...(outletId ? { outletLinks: { some: { outletId, enabled: true } } } : {}) },
        }),
        prisma.outlet.findMany({
          where: { businessId: business.id, ...(outletId ? { id: outletId } : {}) },
          orderBy: { createdAt: "asc" },
        }),
        prisma.user.findMany({
          where: { businessId: business.id, ...(outletId ? { OR: [{ outletAssignments: { none: {} } }, { outletAssignments: { some: { outletId } } }] } : {}) },
        }),
        prisma.purchaseOrder.count({
          where: {
            businessId: business.id,
            status: { in: ["pending", "approved"] },
            ...(outletId ? { outletId } : {}),
          },
        }),
        prisma.routePlan.findMany({
          where: routeWhere,
          include: {
            stops: outletId ? { where: { outletId } } : true,
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.allocation.findMany({
          where: allocationWhere,
          include: { outlet: true, routePlan: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.routePlan.count({ where: routeWhere }),
        prisma.allocation.count({ where: allocationWhere }),
      ]);

      const totalsByOutlet = new Map(bills.map((row) => [row.outlet_id, row]));
      const scopedInventory = inventory.map(item => outletId ? { ...item, stock: item.outletLinks[0].stock, reorderLevel: item.outletLinks[0].reorderLevel } : item);
      const historicalOutletIds = new Set(bills.map((row) => row.outlet_id));
      const salesByOutlet = reportOutlets(outlets, historicalOutletIds, outletId).map((outlet) => ({
        outlet_id: outlet.id,
        outlet_name: outlet.name,
        status: outlet.status || 'active',
        sales: Number(totalsByOutlet.get(outlet.id)?.revenue || 0),
      }));

      const data = {
        generated_at: new Date().toISOString(),
        outlet_id: outletId,
        overview: {
          total_sales: bills.reduce((sum, row) => sum + Number(row.revenue), 0),
          total_bills: bills.reduce((sum, row) => sum + row.revenue_bills, 0),
          total_products: products.length,
          total_inventory_items: inventory.length,
          total_outlets: outlets.length,
          total_staff: staff.length,
          open_purchase_orders: purchaseOrderCount,
          scheduled_routes: routeCount,
        },
        outlets: salesByOutlet,
        route_plans_pagination: { total: routeCount, limit: 5, has_more: routeCount > scheduledRoutes.length },
        restock_logs_pagination: { total: allocationCount, limit: 5, has_more: allocationCount > allocations.length },
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
        inventoryAlerts: scopedInventory
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
      throw error;
    }
  }
}

export const dashboardService = new DashboardService();
