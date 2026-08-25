import { randomUUID } from "crypto";
import { Router } from "express";

import prisma from "../database/prisma/client.js";
import { billingService } from "../core/billing/billing.service.js";
import { inventoryOperationsService } from "../core/inventory/inventory-operations.service.js";
import { normalizeLegacyBillRecord, toLegacyBillRecord } from "../core/billing/billing-legacy.serializer.js";
import {
  getBillChannel,
  getBillOutletId,
  getBillRevenue as getBillNetRevenue,
  isRevenueBill,
} from "../core/billing/bill-analytics.utils.js";
import { authService } from "../core/auth/auth.service.js";
import { getSessionIdFromRequest } from "../core/auth/auth-session.js";
import { outletsService } from "../core/outlets/outlets.service.js";
import { tableManagementService } from "../features/sales-extensions/table-management/table-management.service.js";
import { ensureBusiness, serializeBill, toPrismaInventoryPayload } from "../database/prisma/helpers.js";
import {
  billingSeedData,
  inventorySeedData,
  outletSeedData,
  productSeedData,
} from "../shared/data/core-seed-data.js";
import {
  deliveryRoutePlanItems,
  outletPurchaseOrderItems,
} from "../shared/data/feature-mock-data.js";
import { createHttpError } from "../shared/utils/http-error.js";
import { requireAuth, requirePermission, requireRole } from "../shared/middleware/authGuard.middleware.js";
import { createSyncEnvelope, isAdminCoreSyncRequest } from "../core/sync/sync-contract.js";

const router = Router();

const nowIso = () => new Date().toISOString();
const todayDate = () => new Date().toISOString().slice(0, 10);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getPeriodRange = (period = "all", now = new Date()) => {
  const normalized = String(period || "all").toLowerCase();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);

  if (normalized === "today") {
    return { key: "today", start: startToday, end: startTomorrow };
  }

  if (normalized === "yesterday") {
    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);
    return { key: "yesterday", start: startYesterday, end: startToday };
  }

  if (normalized === "week") {
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - startWeek.getDay());
    return { key: "week", start: startWeek, end: startTomorrow };
  }

  if (normalized === "month") {
    return { key: "month", start: new Date(now.getFullYear(), now.getMonth(), 1), end: startTomorrow };
  }

  return { key: "all", start: null, end: null };
};

const isBillInPeriod = (bill, periodRange) => {
  const createdAt = new Date(bill.created_at);
  if (Number.isNaN(createdAt.getTime())) return false;
  if (periodRange.start && createdAt < periodRange.start) return false;
  if (periodRange.end && createdAt >= periodRange.end) return false;
  return true;
};

const buildProductCostMap = async (tenantId) => {
  try {
    const business = await ensureBusiness({ tenantId });
    const products = await prisma.product.findMany({
      where: { businessId: business.id },
      select: { id: true, name: true, costPrice: true },
    });
    return new Map(products.flatMap((product) => [
      [product.id, toNumber(product.costPrice, 0)],
      [product.name, toNumber(product.costPrice, 0)],
    ]));
  } catch {
    return new Map(productSeedData.flatMap((product) => [
      [product.id, toNumber(product.cost_price ?? product.costPrice, 0)],
      [product.name, toNumber(product.cost_price ?? product.costPrice, 0)],
    ]));
  }
};

const getBillGoodsCost = (bill, productCostMap) =>
  (bill.items || []).reduce((sum, item) => {
    const quantity = toNumber(item.quantity, 0);
    const unitCost = toNumber(item.unit_cost ?? productCostMap.get(item.productId) ?? productCostMap.get(item.product_id) ?? productCostMap.get(item.name), 0);
    return sum + unitCost * quantity;
  }, 0);

const buildRevenueAnalytics = async ({ tenantId, bills, period = "all" }) => {
  const periodRange = getPeriodRange(period);
  const productCostMap = await buildProductCostMap(tenantId);
  const selectedBills = bills
    .filter((bill) => isRevenueBill(bill))
    .filter((bill) => isBillInPeriod(bill, periodRange));

  const billRows = selectedBills.map((bill) => {
    const revenue = getBillNetRevenue(bill);
    const goodsCost = getBillGoodsCost(bill, productCostMap);
    return {
      ...bill,
      revenue,
      goods_cost: goodsCost,
      gross_profit: revenue - goodsCost,
      channel: getBillChannel(bill),
    };
  });

  const revenue = billRows.reduce((sum, bill) => sum + bill.revenue, 0);
  const goodsCost = billRows.reduce((sum, bill) => sum + bill.goods_cost, 0);
  const onlineRevenue = billRows
    .filter((bill) => bill.channel === "online")
    .reduce((sum, bill) => sum + bill.revenue, 0);
  const dineInRevenue = billRows
    .filter((bill) => bill.channel === "dine_in")
    .reduce((sum, bill) => sum + bill.revenue, 0);
  const grossProfit = revenue - goodsCost;

  return {
    period: periodRange.key,
    revenue,
    goods_cost: goodsCost,
    gross_profit: grossProfit,
    margin_percent: revenue ? (grossProfit / revenue) * 100 : 0,
    online_revenue: onlineRevenue,
    dine_in_revenue: dineInRevenue,
    order_count: billRows.length,
    avg_order_value: billRows.length ? revenue / billRows.length : 0,
    bills: billRows,
  };
};

const daysBetween = (isoDate) => {
  if (!isoDate) return null;
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
};

const normalizeInventoryItem = (item) => {
  const currentStock = toNumber(item.current_stock ?? item.stock, 0);
  const reorderLevel = toNumber(item.reorder_level ?? item.reorderLevel, 10);
  const avgDailyConsumption = toNumber(item.avg_daily_consumption, 0);

  return {
    id: item.id || randomUUID(),
    name: item.name || "Unnamed Item",
    unit: item.unit || "kg",
    current_stock: currentStock,
    stock: currentStock,
    reorder_level: reorderLevel,
    reorderLevel,
    vendor: item.vendor || "",
    storage_location: item.storage_location || item.storageLocation || "",
    notes: item.notes || "",
    expiry_date: item.expiry_date || null,
    conversion_cost: toNumber(item.conversion_cost, 0),
    avg_daily_consumption: avgDailyConsumption,
    days_remaining:
      avgDailyConsumption > 0 ? Math.floor(currentStock / Math.max(avgDailyConsumption, 1)) : null,
    wastage_last_30_days: toNumber(item.wastage_last_30_days, 0),
    pilferage_last_30_days: toNumber(item.pilferage_last_30_days, 0),
    ingredient_name: item.ingredient_name || item.name || "Unnamed Item",
  };
};

const normalizeOutlet = (outlet) => ({
  id: outlet.id || randomUUID(),
  name: outlet.name || "Outlet",
  code: outlet.code || "OUT",
  location: outlet.location || "",
  manager_name: outlet.manager_name || "",
  phone: outlet.phone || "",
  status: outlet.status || "active",
  delivery_window: outlet.delivery_window || "",
  notes: outlet.notes || "",
  inventory_lines: toNumber(outlet.inventory_lines, 0),
  open_purchase_orders: toNumber(outlet.open_purchase_orders, 0),
});

const seedInventoryItems = inventorySeedData.map((item) =>
  normalizeInventoryItem({
    ...item,
    current_stock: item.stock,
    reorder_level: 10,
  }),
);

const seedOutlets = outletSeedData.map((outlet) =>
  normalizeOutlet({
    ...outlet,
    delivery_window: "9:00 AM - 11:00 AM",
  }),
);

const seedPurchaseOrders = outletPurchaseOrderItems.map((item, index) => ({
  id: item.id,
  outlet_id: item.outletId,
  outlet_name: seedOutlets.find((outlet) => outlet.id === item.outletId)?.name || `Outlet ${index + 1}`,
  priority: "Medium",
  status: item.status,
  items:
    (item.items || []).map((line) => ({
      inventory_id: line.inventoryItemId,
      inventory_name: line.name,
      requested_quantity: toNumber(line.quantity, 0),
      unit: line.unit || "kg",
    })) || [],
  notes: "",
}));

const seedRoutePlans = deliveryRoutePlanItems.map((route) => ({
  id: route.id,
  route_name: `Route ${route.id}`,
  dispatch_date: todayDate(),
  driver_name: route.driverName || "",
  vehicle_number: route.vehicleId || "",
  status: route.status || "planned",
  stops:
    (route.stops || []).map((stop) => ({
      outlet_id: stop.outletId,
      outlet_name: seedOutlets.find((outlet) => outlet.id === stop.outletId)?.name || "Outlet",
      eta: stop.eta || "",
    })) || [],
}));

let legacyInventoryItems = [...seedInventoryItems];
const legacyInventoryMovements = new Map();
let legacyOutlets = [...seedOutlets];
let legacyPurchaseOrders = [...seedPurchaseOrders];
let legacyRoutePlans = [...seedRoutePlans];
let legacyOutletInventory = [];
let legacyRestockLogs = [];
let legacyShiftSwaps = [];

const getInventoryItems = async (tenantId) => {
  try {
    const business = await ensureBusiness({ tenantId });
    const items = await prisma.inventoryItem.findMany({
      where: { businessId: business.id },
      include: { movements: true },
      orderBy: { createdAt: "asc" },
    });

    return items.map((item) => {
      const last30DaysStart = new Date();
      last30DaysStart.setDate(last30DaysStart.getDate() - 30);
      last30DaysStart.setHours(0, 0, 0, 0);

      const recentMovements = (item.movements || []).filter((movement) => movement.createdAt >= last30DaysStart);
      const consumptionIn30Days = recentMovements
        .filter((movement) => ["consumption", "bill_deduction"].includes(movement.movementType))
        .reduce((sum, movement) => sum + Math.abs(toNumber(movement.quantity, 0)), 0);
      const wastageIn30Days = recentMovements
        .filter((movement) => movement.movementType === "wastage")
        .reduce((sum, movement) => sum + Math.abs(toNumber(movement.quantity, 0)), 0);
      const pilferageIn30Days = recentMovements
        .filter((movement) => movement.movementType === "pilferage")
        .reduce((sum, movement) => sum + Math.abs(toNumber(movement.quantity, 0)), 0);

      return normalizeInventoryItem({
        id: item.id,
        name: item.name,
        unit: item.unit,
        current_stock: item.stock,
        reorder_level: item.reorderLevel,
        vendor: item.vendor,
        storage_location: item.storageLocation,
        notes: item.notes,
        expiry_date: item.expiryDate ? item.expiryDate.toISOString() : null,
        conversion_cost: item.conversionCost,
        avg_daily_consumption: consumptionIn30Days / 30,
        wastage_last_30_days: wastageIn30Days,
        pilferage_last_30_days: pilferageIn30Days,
      });
    });
  } catch {
    return legacyInventoryItems.map((item) => normalizeInventoryItem(item));
  }
};

const setInventoryItems = (items) => {
  legacyInventoryItems = items.map((item) => normalizeInventoryItem(item));
};
const getOutlets = async (tenantId) => {
  try {
    const outlets = await outletsService.listOutlets({ tenantId });
    return outlets.map((outlet) =>
      normalizeOutlet({
        id: outlet.id,
        name: outlet.name,
        code: outlet.code,
        location: outlet.location || "",
        manager_name: outlet.managerName || "",
        phone: outlet.phone || "",
        status: outlet.status,
      }),
    );
  } catch {
    return [];
  }
};

const tenantScopedLegacyRows = (rows, outletIds) =>
  rows.filter((row) => !row.outlet_id || outletIds.has(row.outlet_id));

const tenantScopedRoutePlans = (rows, outletIds) =>
  rows
    .map((row) => ({
      ...row,
      stops: (row.stops || []).filter((stop) => !stop.outlet_id || outletIds.has(stop.outlet_id)),
    }))
    .filter((row) => row.stops.length > 0);


const getInventorySummary = async (tenantId) => {
  const items = await getInventoryItems(tenantId);
  const atRiskItems = items.filter((item) => item.current_stock <= Math.max(item.reorder_level, 10));
  const expiryAlerts = items.filter((item) => {
    const daysLeft = daysBetween(item.expiry_date);
    return daysLeft != null && daysLeft <= 14;
  });

  return {
    items,
    at_risk_items: atRiskItems,
    expiry_alerts: expiryAlerts,
    total_wastage_last_30_days: items.reduce((sum, item) => sum + toNumber(item.wastage_last_30_days, 0), 0),
    total_pilferage_last_30_days: items.reduce((sum, item) => sum + toNumber(item.pilferage_last_30_days, 0), 0),
    total_inventory_items: items.length,
  };
};

const getBills = async (tenantId, limit, outletId = null) => {
  try {
    const data = await billingService.listInvoices({ tenantId, limit });
    const bills = data.map((bill) => toLegacyBillRecord(bill));
    return outletId ? bills.filter((bill) => getBillOutletId(bill) === outletId) : bills;
  } catch {
    const bills = billingSeedData.map((bill) =>
      normalizeLegacyBillRecord({
        ...bill,
        customer_name: bill.customerName,
      }),
    );
    return outletId ? bills.filter((bill) => getBillOutletId(bill) === outletId) : bills;
  }
};

const getAllRevenueBills = async (tenantId, outletId = null) => {
  try {
    const business = await ensureBusiness({ tenantId });
    const rows = await prisma.bill.findMany({
      where: { businessId: business.id },
      include: { business: true, feedback: true, items: true, order: { select: { outletId: true } } },
      orderBy: { createdAt: "desc" },
    });
    const bills = rows.map((bill) => {
      const serializedBill = serializeBill(bill);
      return toLegacyBillRecord({
        ...serializedBill,
        outlet_id: getBillOutletId(bill) || serializedBill.outlet_id,
      });
    });
    return outletId ? bills.filter((bill) => getBillOutletId(bill) === outletId) : bills;
  } catch {
    return getBills(tenantId, 250, outletId);
  }
};

const getDashboardStats = async (tenantId, outletId = null, period = "all") => {
  const outlets = await getOutlets(tenantId);
  const outletIds = new Set(outlets.map((outlet) => outlet.id));
  const bills = await getAllRevenueBills(tenantId, outletId);
  const revenueDetail = await buildRevenueAnalytics({ tenantId, bills, period });
  const allTimeRevenueDetail = period === "all"
    ? revenueDetail
    : await buildRevenueAnalytics({ tenantId, bills, period: "all" });
  const inventorySummary = await getInventorySummary(tenantId);
  const lowStockProducts = productSeedData.filter((product) => toNumber(product.stock, 0) <= 10);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const revenueBills = bills.filter(isRevenueBill);
  const todayBills = revenueBills.filter((bill) => new Date(bill.created_at) >= todayStart);
  const onlineOrders = bills.filter((bill) => isRevenueBill(bill) && getBillChannel(bill) === "online");
  const topSellingMap = new Map();
  revenueBills.forEach((bill) => {
    (bill.items || []).forEach((item) => {
      const current = topSellingMap.get(item.name) || { name: item.name, quantity: 0 };
      current.quantity += toNumber(item.quantity, 0);
      topSellingMap.set(item.name, current);
    });
  });
  const salesByOutlet = outlets.map((outlet) => {
    const outletBills = revenueBills.filter((bill) => getBillOutletId(bill) === outlet.id);
    return {
      outlet_id: outlet.id,
      outlet_name: outlet.name,
      bills: outletBills.length,
      sales: outletBills.reduce((sum, bill) => sum + getBillNetRevenue(bill), 0),
    };
  });

  return {
    total_sales_today: todayBills.reduce((sum, bill) => sum + getBillNetRevenue(bill), 0),
    bills_count_today: todayBills.length,
    online_orders_count: onlineOrders.length,
    online_sales: onlineOrders.reduce((sum, bill) => sum + getBillNetRevenue(bill), 0),
    recent_bills: bills.slice(0, 8),
    today_bills: todayBills,
    online_orders_details: onlineOrders,
    recent_online_orders: onlineOrders.slice(0, 8),
    sales_by_outlet: salesByOutlet,
    low_stock_products: lowStockProducts,
    top_selling: Array.from(topSellingMap.values()).sort((left, right) => right.quantity - left.quantity).slice(0, 6),
    cashier_count: 1,
    total_revenue: allTimeRevenueDetail.revenue,
    revenue_summary: {
      goods_cost: allTimeRevenueDetail.goods_cost,
      gross_profit: allTimeRevenueDetail.gross_profit,
      margin_percent: allTimeRevenueDetail.margin_percent,
    },
    revenue_detail: revenueDetail,
    inventory_summary: {
      at_risk_count: inventorySummary.at_risk_items.length,
      expiry_alert_count: inventorySummary.expiry_alerts.length,
      wastage_last_30_days: inventorySummary.total_wastage_last_30_days,
      at_risk_items: inventorySummary.at_risk_items,
      expiry_alerts: inventorySummary.expiry_alerts,
    },
    recipe_analytics: {
      recipe_product_count: 0,
      blocked_product_count: 0,
      recipe_coverage_percent: 0,
      top_recipe_cost_products: [],
      top_ingredient_usage: [],
      most_ordered_recipe_products: [],
    },
    central_kitchen: await getCentralKitchenSnapshot(tenantId),
  };
};

const getCentralKitchenSnapshot = async (tenantId) => {
  const inventorySummary = await getInventorySummary(tenantId);
  const outlets = await getOutlets(tenantId);
  const outletIds = new Set(outlets.map((outlet) => outlet.id));
  const purchaseOrders = tenantScopedLegacyRows(legacyPurchaseOrders, outletIds);
  const routePlans = tenantScopedRoutePlans(legacyRoutePlans, outletIds);
  const outletInventory = tenantScopedLegacyRows(legacyOutletInventory, outletIds);
  const restockLogs = tenantScopedLegacyRows(legacyRestockLogs, outletIds);

  return {
    overview: {
      total_outlets: outlets.length,
      open_purchase_orders: purchaseOrders.filter((item) => item.status !== "completed").length,
      scheduled_routes: routePlans.filter((item) => item.status !== "completed").length,
      central_inventory_value: inventorySummary.items.reduce(
        (sum, item) => sum + toNumber(item.current_stock, 0) * toNumber(item.conversion_cost, 0),
        0,
      ),
      restocks_this_week: restockLogs.length,
    },
    outlets,
    central_inventory: inventorySummary.items,
    low_stock_items: inventorySummary.at_risk_items,
    purchase_orders: purchaseOrders,
    route_plans: routePlans,
    outlet_inventory: outletInventory,
    restock_logs: restockLogs,
  };
};

router.get("/dashboard/stats", requirePermission("dashboard"), async (req, res, next) => {
  try {
    res
      .status(200)
      .json(await getDashboardStats(req.context.tenantId, req.query?.outlet_id || null, req.query?.period || "all"));
  } catch (error) {
    next(error);
  }
});

router.get("/bills", async (req, res, next) => {
  try {
    res
      .status(200)
      .json(await getBills(req.context.tenantId, req.query?.limit, req.query?.outlet_id || null));
  } catch (error) {
    next(error);
  }
});

router.get("/table-reservations", async (req, res, next) => {
  try {
    res.status(200).json(
      await tableManagementService.listLegacyReservations({
        tenantId: req.context.tenantId,
        businessId: req.context.businessId,
        includeHistory: String(req.query.include_history || "").toLowerCase() === "true",
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/table-reservations", async (req, res, next) => {
  try {
    const reservation = await tableManagementService.createReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      payload: req.body,
    });
    res.status(201).json(reservation);
  } catch (error) {
    next(error);
  }
});

router.post("/table-reservations/:reservationId/confirm", async (req, res, next) => {
  try {
    const reservation = await tableManagementService.confirmReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      reservationId: req.params.reservationId,
    });
    res.status(200).json(reservation);
  } catch (error) {
    next(error);
  }
});

router.post("/table-reservations/:reservationId/undo", async (req, res, next) => {
  try {
    const reservation = await tableManagementService.undoReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      reservationId: req.params.reservationId,
    });
    res.status(200).json(reservation);
  } catch (error) {
    next(error);
  }
});

router.delete("/table-reservations/:reservationId", async (req, res, next) => {
  try {
    const reservation = await tableManagementService.deleteReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      reservationId: req.params.reservationId,
    });
    res.status(200).json(reservation);
  } catch (error) {
    next(error);
  }
});

router.post("/bills", requireAuth, async (req, res, next) => {
  try {
    const currentUser = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });
    const timestamp = nowIso();
    const payload = {
      ...req.body,
      customer_name: req.body.customer_name || req.body.customerName || null,
      order_type: req.body.order_type || "Dine-In",
      payment_type: req.body.payment_type || null,
      created_by: currentUser?.id || null,
      created_by_name: currentUser?.name || null,
      created_by_role: currentUser?.role || null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const created = await billingService.createInvoice({
      tenantId: req.context.tenantId,
      payload,
    });
    const data = await billingService.updateInvoice({
      tenantId: req.context.tenantId,
      invoiceId: created.id,
      payload: {
        feedback_token: `feedback-${created.id}`,
        feedback_link: `${req.protocol}://${req.get("host")}/feedback/feedback-${created.id}`,
        updated_at: timestamp,
      },
    });
    res.status(201).json(toLegacyBillRecord(data));
  } catch (error) {
    next(error);
  }
});

router.get("/bills/:invoiceId", async (req, res, next) => {
  try {
    const data = await billingService.getInvoiceById({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
    });
    res.status(200).json(toLegacyBillRecord(data));
  } catch (error) {
    next(error);
  }
});

router.put("/bills/:invoiceId", async (req, res, next) => {
  try {
    const data = await billingService.updateInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      payload: {
        ...req.body,
        updated_at: nowIso(),
      },
    });
    res.status(200).json(toLegacyBillRecord(data));
  } catch (error) {
    next(error);
  }
});

router.put("/bills/:invoiceId/kitchen-status", async (req, res, next) => {
  try {
    const data = await billingService.updateInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      payload: {
        ...req.body,
        updated_at: nowIso(),
      },
    });
    res.status(200).json(toLegacyBillRecord(data));
  } catch (error) {
    next(error);
  }
});

router.delete("/bills/:invoiceId", async (req, res, next) => {
  try {
    const data = await billingService.deleteInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
    });
    res.status(200).json(toLegacyBillRecord(data));
  } catch (error) {
    next(error);
  }
});

router.get("/inventory", async (req, res, next) => {
  try {
    const summary = await getInventorySummary(req.context.tenantId);
    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "inventory",
          data: summary.items || [],
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
        }),
      );
    }
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/catalog", async (req, res, next) => {
  try {
    res.status(200).json(await getInventoryItems(req.context.tenantId));
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/units", async (req, res, next) => {
  try {
    const units = [...new Set((await getInventoryItems(req.context.tenantId)).map((item) => item.unit).filter(Boolean))].map((unit) => ({
      name: unit,
    }));
    res.status(200).json(units);
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/reports/cogs", async (req, res, next) => {
  try {
    res.status(200).json(
      await inventoryOperationsService.getCogsReport({
        tenantId: req.context.tenantId,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/purchase-suggestions", async (req, res, next) => {
  try {
    res.status(200).json(
      await inventoryOperationsService.getLowStockSuggestions({
        tenantId: req.context.tenantId,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/purchase-receivings", async (req, res, next) => {
  try {
    res.status(201).json(
      await inventoryOperationsService.receivePurchase({
        tenantId: req.context.tenantId,
        payload: req.body,
        user: req.user,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/vendor-bills", async (req, res, next) => {
  try {
    res.status(201).json(
      await inventoryOperationsService.createVendorBill({
        tenantId: req.context.tenantId,
        payload: req.body,
        user: req.user,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/stock-audits", async (req, res, next) => {
  try {
    res.status(201).json(
      await inventoryOperationsService.createStockAudit({
        tenantId: req.context.tenantId,
        payload: req.body,
        user: req.user,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/transfers", async (req, res, next) => {
  try {
    res.status(201).json(
      await inventoryOperationsService.createTransferRequest({
        tenantId: req.context.tenantId,
        payload: req.body,
        user: req.user,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/transfers/:allocationId/approve", async (req, res, next) => {
  try {
    res.status(200).json(
      await inventoryOperationsService.approveTransfer({
        tenantId: req.context.tenantId,
        allocationId: req.params.allocationId,
        user: req.user,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/transfers/:allocationId/receive", async (req, res, next) => {
  try {
    res.status(200).json(
      await inventoryOperationsService.receiveTransfer({
        tenantId: req.context.tenantId,
        allocationId: req.params.allocationId,
        user: req.user,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/:itemId", async (req, res, next) => {
  try {
    const item = (await getInventoryItems(req.context.tenantId)).find((entry) => entry.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ detail: "Inventory item not found" });
      return;
    }
    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
});

router.post("/inventory", async (req, res, next) => {
  try {
    const business = await ensureBusiness({ tenantId: req.context.tenantId });
    const created = await prisma.inventoryItem.create({
      data: {
        businessId: business.id,
        ...toPrismaInventoryPayload({
          ...req.body,
          stock: req.body.current_stock ?? req.body.stock,
          reorderLevel: req.body.reorder_level ?? req.body.reorderLevel,
        }),
      },
    });
    const item = normalizeInventoryItem({
      id: created.id,
      name: created.name,
      unit: created.unit,
      current_stock: created.stock,
      reorder_level: created.reorderLevel,
      vendor: created.vendor,
      storage_location: created.storageLocation,
      notes: created.notes,
      expiry_date: created.expiryDate ? created.expiryDate.toISOString() : null,
      conversion_cost: created.conversionCost,
    });
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
});

router.put("/inventory/:itemId", async (req, res, next) => {
  try {
    const business = await ensureBusiness({ tenantId: req.context.tenantId });
    const existing = await prisma.inventoryItem.findFirst({
      where: { id: req.params.itemId, businessId: business.id },
    });
    if (!existing) {
      res.status(404).json({ detail: "Inventory item not found" });
      return;
    }

    const updated = await prisma.inventoryItem.update({
      where: { id: req.params.itemId },
      data: toPrismaInventoryPayload({
        name: req.body.name ?? existing.name,
        stock: req.body.current_stock ?? req.body.stock ?? existing.stock,
        unit: req.body.unit ?? existing.unit,
        reorderLevel: req.body.reorder_level ?? req.body.reorderLevel ?? existing.reorderLevel,
        vendor: req.body.vendor ?? existing.vendor,
        storage_location: req.body.storage_location ?? req.body.storageLocation ?? existing.storageLocation,
        notes: req.body.notes ?? existing.notes,
        expiry_date: req.body.expiry_date ?? req.body.expiryDate ?? existing.expiryDate,
        conversion_cost: req.body.conversion_cost ?? req.body.conversionCost ?? existing.conversionCost,
      }),
    });

    res.status(200).json(
      normalizeInventoryItem({
        id: updated.id,
        name: updated.name,
        unit: updated.unit,
        current_stock: updated.stock,
        reorder_level: updated.reorderLevel,
        vendor: updated.vendor,
        storage_location: updated.storageLocation,
        notes: updated.notes,
        expiry_date: updated.expiryDate ? updated.expiryDate.toISOString() : null,
        conversion_cost: updated.conversionCost,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.delete("/inventory/:itemId", async (req, res, next) => {
  try {
    const business = await ensureBusiness({ tenantId: req.context.tenantId });
    const existing = await prisma.inventoryItem.findFirst({
      where: { id: req.params.itemId, businessId: business.id },
    });
    if (!existing) {
      res.status(404).json({ detail: "Inventory item not found" });
      return;
    }

    await prisma.inventoryItem.delete({ where: { id: req.params.itemId } });
    legacyInventoryMovements.delete(req.params.itemId);
    res.status(200).json({ id: existing.id, name: existing.name });
  } catch (error) {
    next(error);
  }
});

router.get("/inventory/:itemId/movements", async (req, res, next) => {
  try {
    const business = await ensureBusiness({ tenantId: req.context.tenantId });
    const item = await prisma.inventoryItem.findFirst({
      where: { id: req.params.itemId, businessId: business.id },
    });
    if (!item) {
      res.status(404).json({ detail: "Inventory item not found" });
      return;
    }

    const movements = await prisma.inventoryMovement.findMany({
      where: { inventoryItemId: item.id, businessId: business.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json(
      movements.map((movement) => ({
        id: movement.id,
        movement_type: movement.movementType,
        quantity: Math.abs(toNumber(movement.quantity, 0)),
        unit: item.unit,
        reason: movement.reason || "",
        expiry_date: movement.expiryDate ? movement.expiryDate.toISOString() : null,
        created_by_name: "System",
        created_at: movement.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/inventory/:itemId/movements", async (req, res, next) => {
  try {
    const business = await ensureBusiness({ tenantId: req.context.tenantId });
    const item = await prisma.inventoryItem.findFirst({
      where: { id: req.params.itemId, businessId: business.id },
    });
    if (!item) {
      res.status(404).json({ detail: "Inventory item not found" });
      return;
    }

    const quantity = toNumber(req.body.quantity, 0);
    const movementType = req.body.movement_type || "adjustment";
    const signedQuantity =
      movementType === "purchase" || movementType === "adjustment" ? quantity : quantity * -1;

    const movement = await prisma.inventoryMovement.create({
      data: {
        businessId: business.id,
        inventoryItemId: item.id,
        movementType,
        quantity: signedQuantity,
        reason: req.body.reason || "",
        expiryDate: req.body.expiry_date ? new Date(req.body.expiry_date) : null,
      },
    });

    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        stock: Math.max(0, toNumber(item.stock, 0) + signedQuantity),
        expiryDate: req.body.expiry_date ? new Date(req.body.expiry_date) : item.expiryDate,
      },
    });

    res.status(201).json({
      id: movement.id,
      movement_type: movement.movementType,
      quantity: Math.abs(toNumber(movement.quantity, 0)),
      unit: item.unit,
      reason: movement.reason || "",
      expiry_date: movement.expiryDate ? movement.expiryDate.toISOString() : null,
      created_by_name: "System",
      created_at: movement.createdAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/shift-swaps", (_req, res) => {
  res.status(200).json(legacyShiftSwaps);
});

router.post("/shift-swaps", (req, res) => {
  const swap = {
    id: randomUUID(),
    requester_name: "Current User",
    target_staff_name: "Requested Staff",
    target_staff_id: req.body.target_staff_id || null,
    requested_for: req.body.requested_for || nowIso(),
    note: req.body.note || "",
    status: "pending",
  };
  legacyShiftSwaps = [swap, ...legacyShiftSwaps];
  res.status(201).json(swap);
});

router.put("/shift-swaps/:requestId", (req, res) => {
  const existing = legacyShiftSwaps.find((item) => item.id === req.params.requestId);
  if (!existing) {
    res.status(404).json({ detail: "Shift swap not found" });
    return;
  }

  const updated = {
    ...existing,
    status: req.body.status || existing.status,
  };
  legacyShiftSwaps = legacyShiftSwaps.map((item) => (item.id === updated.id ? updated : item));
  res.status(200).json(updated);
});

router.get("/central-kitchen", async (req, res, next) => {
  try {
    res.status(200).json(await getCentralKitchenSnapshot(req.context.tenantId));
  } catch (error) {
    next(error);
  }
});

router.get("/customer-analytics", async (req, res, next) => {
  try {
    const bills = await getBills(req.context.tenantId);
    const customersMap = new Map();
    const itemSalesMap = new Map();

    bills.forEach((bill) => {
      const customerKey =
        String(bill.customer_phone || "").trim() ||
        String(bill.customer_name || "").trim().toLowerCase() ||
        `walkin-${bill.id}`;
      const currentCustomer = customersMap.get(customerKey) || {
        customer_key: customerKey,
        customer_name: bill.customer_name || "Walk-in",
        customer_phone: bill.customer_phone || "",
        visits: 0,
        total_spent: 0,
        loyalty_points: 0,
        favorite_item: "-",
        favorite_category: "-",
        preferred_channel: bill.order_type || "Dine-In",
        segment: "New",
        _itemCounts: new Map(),
      };

      currentCustomer.visits += 1;
      currentCustomer.total_spent += toNumber(bill.total, 0);
      currentCustomer.loyalty_points += Math.floor(toNumber(bill.total, 0) / 10);

      (bill.items || []).forEach((item) => {
        const itemName = item.name || "Item";
        currentCustomer._itemCounts.set(itemName, (currentCustomer._itemCounts.get(itemName) || 0) + toNumber(item.quantity, 0));

        const salesKey = itemName;
        const currentItem = itemSalesMap.get(salesKey) || {
          item_name: itemName,
          category: "-",
          inhouse_qty: 0,
          inhouse_revenue: 0,
          online_qty: 0,
          online_revenue: 0,
          total_qty: 0,
          total_revenue: 0,
        };
        const qty = toNumber(item.quantity, 0);
        const revenue = toNumber(item.price, 0) * qty;
        const isOnline = (bill.order_type || "").toLowerCase().includes("online") || (bill.order_type || "").toLowerCase().includes("delivery");

        if (isOnline) {
          currentItem.online_qty += qty;
          currentItem.online_revenue += revenue;
        } else {
          currentItem.inhouse_qty += qty;
          currentItem.inhouse_revenue += revenue;
        }
        currentItem.total_qty += qty;
        currentItem.total_revenue += revenue;
        itemSalesMap.set(salesKey, currentItem);
      });

      customersMap.set(customerKey, currentCustomer);
    });

    const customers = Array.from(customersMap.values()).map((customer) => {
      const favorite = Array.from(customer._itemCounts.entries()).sort((left, right) => right[1] - left[1])[0];
      const visits = customer.visits;
      return {
        customer_key: customer.customer_key,
        customer_name: customer.customer_name,
        customer_phone: customer.customer_phone,
        visits,
        total_spent: customer.total_spent,
        loyalty_points: customer.loyalty_points,
        favorite_item: favorite?.[0] || "-",
        favorite_category: "-",
        preferred_channel: customer.preferred_channel,
        segment: visits >= 5 ? "VIP" : visits >= 2 ? "Regular" : "New",
      };
    });

    const totalCustomers = customers.length;
    const repeatCustomers = customers.filter((customer) => customer.visits >= 2).length;
    const averageCustomerValue =
      totalCustomers > 0
        ? customers.reduce((sum, customer) => sum + toNumber(customer.total_spent, 0), 0) / totalCustomers
        : 0;

    res.status(200).json({
      summary: {
        total_customers: totalCustomers,
        repeat_customers: repeatCustomers,
        loyalty_points_issued: customers.reduce((sum, customer) => sum + toNumber(customer.loyalty_points, 0), 0),
        average_customer_value: averageCustomerValue,
        average_feedback: 0,
      },
      customers,
      item_sales_by_channel: Array.from(itemSalesMap.values()),
      campaign_suggestions: customers
        .filter((customer) => customer.customer_name && customer.customer_name !== "Walk-in")
        .slice(0, 6)
        .map((customer) => ({
          customer_name: customer.customer_name,
          customer_phone: customer.customer_phone,
          segment: customer.segment,
          favorite_item: customer.favorite_item,
          offer:
            customer.segment === "VIP"
              ? `Priority offer on ${customer.favorite_item}`
              : customer.segment === "Regular"
                ? `Come-back offer for ${customer.favorite_item}`
                : `First-repeat discount on ${customer.favorite_item}`,
        })),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/central-kitchen/outlets", (req, res) => {
  const outlet = normalizeOutlet({
    id: randomUUID(),
    ...req.body,
  });
  legacyOutlets = [...legacyOutlets, outlet];
  res.status(201).json(outlet);
});

router.post("/central-kitchen/purchase-orders", (req, res) => {
  const outlet = legacyOutlets.find((item) => item.id === req.body.outlet_id);
  const order = {
    id: randomUUID(),
    outlet_id: req.body.outlet_id || null,
    outlet_name: outlet?.name || "Outlet",
    priority: req.body.priority || "Medium",
    status: "pending",
    required_by: req.body.required_by || null,
    notes: req.body.notes || "",
    items: req.body.items || [],
  };
  legacyPurchaseOrders = [order, ...legacyPurchaseOrders];
  res.status(201).json(order);
});

router.post("/central-kitchen/restocks", async (req, res, next) => {
  try {
    const outlet = legacyOutlets.find((item) => item.id === req.body.outlet_id);
    const inventoryItem = (await getInventoryItems(req.context.tenantId)).find((item) => item.id === req.body.inventory_id);

    const log = {
      id: randomUUID(),
      outlet_id: req.body.outlet_id || null,
      outlet_name: outlet?.name || "Outlet",
      inventory_id: req.body.inventory_id || null,
      inventory_name: inventoryItem?.name || "Inventory Item",
      quantity: toNumber(req.body.quantity, 0),
      unit: inventoryItem?.unit || "kg",
      eta: req.body.eta || "",
      route_name: req.body.route_name || "",
      note: req.body.note || "",
    };

    legacyRestockLogs = [log, ...legacyRestockLogs];
    legacyOutletInventory = [log, ...legacyOutletInventory];

    if (inventoryItem) {
      await prisma.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: {
          stock: Math.max(0, toNumber(inventoryItem.current_stock, 0) - toNumber(req.body.quantity, 0)),
        },
      });
    }

    res.status(201).json(log);
  } catch (error) {
    next(error);
  }
});

router.post("/central-kitchen/routes", (req, res) => {
  const route = {
    id: randomUUID(),
    route_name: req.body.route_name || "Route",
    dispatch_date: req.body.dispatch_date || todayDate(),
    driver_name: req.body.driver_name || "",
    vehicle_number: req.body.vehicle_number || "",
    status: req.body.status || "Scheduled",
    stops:
      (req.body.stops || []).map((stop) => ({
        outlet_id: stop.outlet_id,
        outlet_name: legacyOutlets.find((outlet) => outlet.id === stop.outlet_id)?.name || "Outlet",
        eta: stop.eta || "",
      })) || [],
  };
  legacyRoutePlans = [route, ...legacyRoutePlans];
  res.status(201).json(route);
});

export default router;


