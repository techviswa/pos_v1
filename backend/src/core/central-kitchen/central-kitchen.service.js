import prisma from "../../database/prisma/client.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";
import { inventoryForecast } from "../inventory/inventory-forecast.js";
import { outletsService } from "../outlets/outlets.service.js";
import { operationalWrite } from "../../shared/utils/operational-write.js";

const fail = (message, statusCode = 400) => { throw createHttpError({ statusCode, message }); };
const active = { notIn: ["inactive", "Inactive", "INACTIVE", "archived", "Archived"] };
const pending = ["pending", "approved", "pending_approval", "dispatched", "in_transit"];
const key = (value, name, max = 200) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`Enter a valid ${name}`);
  return value.trim();
};
const date = (value, name) => {
  if (!value) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`Enter a valid ${name}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) !== value) fail(`Enter a valid ${name}`);
  return new Date(value);
};
export const centralKitchenService = {
  async snapshot({ tenantId, outletIds = null }) {
    const business = await ensureBusiness({ tenantId });
    const businessId = business.id;
    if (outletIds) {
      const count = await prisma.outlet.count({ where: { businessId, id: { in: outletIds } } });
      if (count !== new Set(outletIds).size) fail("Outlet not found for this business", 404);
    }
    const outletWhere = { businessId, status: active, ...(outletIds ? { id: { in: outletIds } } : {}) };
    const outlets = await prisma.outlet.findMany({ where: outletWhere, orderBy: { name: "asc" } });
    const ids = outlets.map((row) => row.id);
    const since = new Date(Date.now() - 30 * 86400000);
    const [ingredients, balances, movements, orders, routes, transfers, outletDetails] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
      prisma.outletInventory.findMany({ where: { outletId: { in: ids }, outlet: { businessId } }, include: { inventoryItem: true, outlet: { select: { name: true } } } }),
      prisma.inventoryMovement.findMany({ where: { businessId, createdAt: { gte: since }, outletId: outletIds ? { in: ids } : null } }),
      prisma.purchaseOrder.findMany({ where: { businessId, outletId: { in: ids }, priority: { in: ["Low", "Medium", "High", "Urgent", "Critical", "low", "medium", "high", "urgent", "critical"] } }, include: { outlet: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.routePlan.findMany({ where: { businessId, ...(outletIds ? { stops: { some: { outletId: { in: ids } } } } : {}) }, include: { stops: { where: { outletId: { in: ids } }, include: { outlet: { select: { name: true } } }, orderBy: { sequence: "asc" } } }, orderBy: { createdAt: "desc" } }),
      prisma.allocation.findMany({ where: { businessId, outletId: { in: ids } }, include: { outlet: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.stateDocument.findMany({ where: { key: { in: ids.map((id) => `outlet-operations:${businessId}:${id}`) } } }),
    ]);
    const stock = ingredients.map((item) => {
      const rows = balances.filter((row) => row.inventoryItemId === item.id && row.enabled);
      const configured = !outletIds || rows.length > 0;
      const current = !configured ? null : outletIds ? rows.reduce((sum, row) => sum + row.stock, 0) : item.stock;
      const reorder = !configured ? null : outletIds ? rows.reduce((sum, row) => sum + row.reorderLevel, 0) : item.reorderLevel;
      const usage = movements.filter((row) => row.inventoryItemId === item.id && ["consumption", "bill_deduction"].includes(row.movementType) && row.quantity < 0);
      const cost = !configured ? null : outletIds ? (current > 0 ? rows.reduce((sum, row) => sum + row.stock * Number(row.unitCost ?? item.conversionCost), 0) / current : Number(item.conversionCost)) : Number(item.conversionCost);
      return { id: item.id, name: item.name, unit: item.unit, current_stock: current, stock: current, reorder_level: reorder,
        conversion_cost: cost, vendor: item.vendor || "", stock_configured: configured,
        expiry_date: outletIds ? null : item.expiryDate?.toISOString() || null,
        wastage_last_30_days: movements.filter((row) => row.inventoryItemId === item.id && row.movementType === "wastage").reduce((sum, row) => sum + Math.abs(row.quantity), 0),
        pilferage_last_30_days: movements.filter((row) => row.inventoryItemId === item.id && row.movementType === "pilferage").reduce((sum, row) => sum + Math.abs(row.quantity), 0),
        ...inventoryForecast({ stock: current, reorderLevel: reorder, consumed: usage.reduce((sum, row) => sum + Math.abs(row.quantity), 0), movementCount: usage.length }),
        low_stock: configured && current <= reorder };
    });
    const week = new Date(); week.setUTCHours(0, 0, 0, 0); week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
    const fulfilled = transfers.filter((row) => ["received", "completed"].includes(row.status));
    return {
      stock_location: outletIds ? "Selected outlets" : "Central store", observation_days: 30, checked_at: new Date().toISOString(), week_start: week.toISOString(),
      overview: { total_outlets: outlets.length, open_purchase_orders: orders.filter((row) => pending.includes(row.status)).length,
        scheduled_routes: routes.filter((row) => ["scheduled", "Scheduled", "dispatched", "In Transit"].includes(row.status)).length,
        central_inventory_value: stock.reduce((sum, row) => sum + row.current_stock * row.conversion_cost, 0),
        restocks_this_week: fulfilled.filter((row) => row.updatedAt >= week).length,
        pending_transfers: transfers.filter((row) => pending.includes(row.status)).length },
      outlets: outlets.map((row) => ({ id: row.id, name: row.name, code: row.code, location: row.location || "", status: row.status,
        delivery_window: outletDetails.find((detail) => detail.data.outlet_id === row.id)?.data.delivery_window || "", notes: outletDetails.find((detail) => detail.data.outlet_id === row.id)?.data.notes || "",
        inventory_lines: balances.filter((item) => item.outletId === row.id && item.enabled).length,
        open_purchase_orders: orders.filter((order) => order.outletId === row.id && pending.includes(order.status)).length })),
      central_inventory: stock, low_stock_items: stock.filter((row) => row.stock_configured && row.low_stock),
      outlet_inventory: balances.filter((row) => row.enabled).map((row) => ({ id: row.id, outlet_id: row.outletId, outlet_name: row.outlet.name,
        inventory_id: row.inventoryItemId, inventory_name: row.inventoryItem.name, current_stock: row.stock, stock: row.stock, reorder_level: row.reorderLevel, unit: row.inventoryItem.unit })),
      purchase_orders: orders.map((row) => ({ id: row.id, outlet_id: row.outletId, outlet_name: row.outlet.name, priority: row.priority, status: row.status, required_by: row.requiredBy, notes: row.notes, items: row.items, created_at: row.createdAt })),
      route_plans: routes.filter((row) => row.stops.length).map((row) => ({ id: row.id, route_name: row.routeName, dispatch_date: row.dispatchDate, driver_name: row.driverName, vehicle_number: row.vehicleNumber, status: row.status, stops: row.stops.map((stop) => ({ outlet_id: stop.outletId, outlet_name: stop.outlet.name, eta: stop.eta })) })),
      restock_logs: transfers.map((row) => ({ id: row.id, outlet_id: row.outletId, outlet_name: row.outlet.name, status: row.status, created_at: row.createdAt, updated_at: row.updatedAt,
        items: (row.items || []).map((line) => { const item = ingredients.find((ingredient) => ingredient.id === line.inventory_id); return { ...line, inventory_name: line.inventory_name || item?.name || "Ingredient", unit: (!line.unit || line.unit === "unit") ? item?.unit || line.unit : line.unit }; }) })),
    };
  },
  async outlet({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    key(payload.name, "outlet name");
    return operationalWrite({ businessId: business.id, kind: "outlet", payload }, async (tx) => {
      const row = await outletsService.createOutlet({ tenantId, payload, transaction: tx });
      await tx.stateDocument.create({ data: { key: `outlet-operations:${business.id}:${row.id}`, data: { business_id: business.id, outlet_id: row.id,
        delivery_window: String(payload.delivery_window || "").slice(0, 100), notes: String(payload.notes || "").slice(0, 1000) } } });
      return row;
    });
  },
  async purchaseOrder({ tenantId, user, payload }) {
    const business = await ensureBusiness({ tenantId });
    if (payload.priority && !["Low", "Medium", "High", "Urgent"].includes(payload.priority)) fail("Choose Low, Medium, High or Urgent priority");
    const outletId = key(payload.outlet_id, "outlet");
    return operationalWrite({ businessId: business.id, kind: "purchase-order", payload }, async (tx) => {
      if (!await tx.outlet.findFirst({ where: { id: outletId, businessId: business.id, status: active } })) fail("Active outlet not found", 404);
      if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) fail("Select between 1 and 100 ingredients");
      const seen = new Set(), items = [];
      for (const item of payload.items) {
        if (!item || typeof item.inventory_id !== "string" || !item.inventory_id || !Number.isFinite(Number(item.requested_quantity)) || Number(item.requested_quantity) <= 0 || seen.has(item.inventory_id)) fail("Enter distinct ingredients with positive quantities");
        seen.add(item.inventory_id);
        const ingredient = await tx.inventoryItem.findFirst({ where: { id: item.inventory_id, businessId: business.id } });
        if (!ingredient) fail("Ingredient not found for this business", 404);
        items.push({ inventory_id: ingredient.id, inventory_name: ingredient.name, unit: ingredient.unit, requested_quantity: Number(item.requested_quantity) });
      }
      const row = await tx.purchaseOrder.create({ data: { businessId: business.id, outletId, requestedById: user?.id || null,
        priority: ["Low", "Medium", "High", "Urgent"].includes(payload.priority) ? payload.priority : "Medium", requiredBy: date(payload.required_by, "required date"), notes: String(payload.notes || "").slice(0, 1000), status: "pending", items } });
      await admincoreChangeSyncService.notifyChange({ businessId: business.id, tenantId, resource: "inventory", action: "demand_created", recordId: row.id, outletId }, { tx });
      return { id: row.id, status: row.status };
    });
  },
  async route({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    if (!Array.isArray(payload.stops) || !payload.stops.length || payload.stops.length > 50) fail("Choose between 1 and 50 stops");
    const ids = payload.stops.map((stop) => stop?.outlet_id);
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !id)) fail("Choose distinct valid outlets");
    return operationalWrite({ businessId: business.id, kind: "route", payload }, async (tx) => {
      if (await tx.outlet.count({ where: { id: { in: ids }, businessId: business.id, status: active } }) !== ids.length) fail("An active outlet was not found", 404);
      const row = await tx.routePlan.create({ data: { businessId: business.id, routeName: key(payload.route_name, "route name"), dispatchDate: date(payload.dispatch_date, "dispatch date"), driverName: String(payload.driver_name || "").slice(0, 100), vehicleNumber: String(payload.vehicle_number || "").slice(0, 40), status: "scheduled",
        stops: { create: payload.stops.map((stop, index) => ({ outletId: stop.outlet_id, sequence: index + 1, eta: stop.eta ? String(stop.eta).slice(0, 80) : null })) } } });
      await admincoreChangeSyncService.notifyChange({ businessId: business.id, tenantId, resource: "inventory", action: "route_created", recordId: row.id }, { tx });
      return { id: row.id, status: row.status };
    });
  },
};
