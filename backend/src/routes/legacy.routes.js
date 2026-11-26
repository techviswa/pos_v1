import { randomUUID } from "crypto";
import { Router } from "express";
import { buildSalesCharts } from "../core/dashboard/sales-charts.js";
import { reportOutlets } from '../core/dashboard/outlet-report-policy.js';
import { recipeAnalytics } from "../core/dashboard/recipe-analytics.js";
import { reportsService } from "../core/reports/reports.service.js";
import { customerInsights } from "../core/reports/customer-insights.js";

import prisma from "../database/prisma/client.js";
import { readState, writeState } from "../database/prisma/state-store.js";
import { billingService } from "../core/billing/billing.service.js";
import { inventoryOperationsService } from "../core/inventory/inventory-operations.service.js";
import { inventoryService } from "../core/inventory/inventory.service.js";
import { centralKitchenService } from "../core/central-kitchen/central-kitchen.service.js";
import { moveStock } from "../core/inventory/stock-ledger.service.js";
import { admincoreChangeSyncService } from "../core/admincore/admincore-change-sync.service.js";
import { normalizeLegacyBillRecord, toLegacyBillRecord } from "../core/billing/billing-legacy.serializer.js";
import {
  getBillChannel,
  getBillOutletId,
  getBillRevenue as getBillNetRevenue,
  isRevenueBill,
} from "../core/billing/bill-analytics.utils.js";
import { authService } from "../core/auth/auth.service.js";
import { signFeedbackToken } from "../core/feedback/feedback-token.js";

// The feedback page is a frontend route; the API host would 404. Use the configured public site, else the caller origin.
const publicFrontendBase = (req) => String(
  process.env.QR_PUBLIC_BASE_URL || process.env.PUBLIC_QR_BASE_URL || req.get("origin") || `${req.protocol}://${req.get("host")}`,
).replace(/\/+$/, "");

import { assertOwnedIds } from "../database/prisma/scope.js";
import { filterByOutletScope } from "../shared/middleware/outletScope.js";
import { applyDefaultOutlet, invoiceOutletGuard, scopeOutletQuery } from "../shared/middleware/recordOutletGuards.js";
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
import { requireAuth, requireAnyPermission, requirePermission, requireRole } from "../shared/middleware/authGuard.middleware.js";
import { createSyncEnvelope, isAdminCoreSyncRequest } from "../core/sync/sync-contract.js";

const router = Router();
router.param("invoiceId", invoiceOutletGuard);
router.use("/inventory", (req, res, next) => req.method === "GET"
  ? requireAnyPermission("inventory", "reports")(req, res, next) : requirePermission("inventory")(req, res, next));

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

// Sales are what customers paid (incl. GST, less refunds). Profit uses the same calculation as Reports:
// GST excluded, and each bill's cost as recorded when it was sold. Items sold with no cost known are counted
// so the margin is not presented as complete.
const buildRevenueAnalytics = async ({ tenantId, bills, period = "all", outletId = null }) => {
  const periodRange = getPeriodRange(period);
  const selectedBills = bills
    .filter((bill) => isRevenueBill(bill))
    .filter((bill) => isBillInPeriod(bill, periodRange));
  const profit = await reportsService.profitSummary({ tenantId, outletId, start: periodRange.start || null, end: periodRange.end || null });

  const billRows = selectedBills.map((bill) => {
    const revenue = getBillNetRevenue(bill);
    const figures = profit.bills.get(bill.id) || { net_sales: revenue, goods_cost: 0, gross_profit: revenue };
    return {
      ...bill,
      revenue,
      net_sales: figures.net_sales,
      goods_cost: figures.goods_cost,
      gross_profit: figures.gross_profit,
      channel: getBillChannel(bill),
    };
  });

  const revenue = billRows.reduce((sum, bill) => sum + bill.revenue, 0);
  const onlineRevenue = billRows
    .filter((bill) => bill.channel === "online")
    .reduce((sum, bill) => sum + bill.revenue, 0);
  const dineInRevenue = billRows
    .filter((bill) => bill.channel === "dine_in")
    .reduce((sum, bill) => sum + bill.revenue, 0);

  return {
    period: periodRange.key,
    revenue,
    net_sales: profit.net_sales,
    goods_cost: profit.goods_cost,
    gross_profit: profit.gross_profit,
    margin_percent: profit.margin_percent,
    items_without_cost: profit.items_without_cost,
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
      avgDailyConsumption > 0 ? Math.round(currentStock / avgDailyConsumption * 10) / 10 : null,
    usage_history_available: avgDailyConsumption > 0,
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
// Shift swaps are per business. (This used to be one process-wide array shared by every tenant.)
// Shift swap requests are kept in the database (they used to live in server memory and vanished on restart).
const shiftSwapKey = (businessId) => `shift-swaps:${businessId}`;
const shiftSwapsFor = async (businessId, client = prisma) => (await readState(shiftSwapKey(businessId), [], client)) || [];
const saveShiftSwaps = async (businessId, change) => prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shiftSwapKey(businessId)}))`;
  const next = await change(await shiftSwapsFor(businessId, tx));
  await writeState(shiftSwapKey(businessId), next.slice(0, 500), tx);
  return next;
});
const isManagerRole = (user) => ["owner", "manager"].includes(String(user?.role || "").trim().toLowerCase());
const SHIFT_SWAP_STATUSES = new Set(["pending", "approved", "rejected", "cancelled"]);

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

      const recentMovements = (item.movements || []).filter((movement) => movement.createdAt >= last30DaysStart && movement.outletId == null);
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
  } catch (error) {
    throw error;
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
  } catch (error) {
    throw error;
  }
};

// Rows are visible only to the business that created them; untagged demo seed rows are never shown to a tenant.
const tenantScopedLegacyRows = (rows, outletIds, businessId) =>
  rows.filter((row) => row.business_id === businessId && (!row.outlet_id || outletIds.has(row.outlet_id)));

const tenantScopedRoutePlans = (rows, outletIds, businessId) =>
  rows
    .filter((row) => row.business_id === businessId)
    .map((row) => ({
      ...row,
      stops: (row.stops || []).filter((stop) => !stop.outlet_id || outletIds.has(stop.outlet_id)),
    }))
    .filter((row) => row.stops.length > 0);


const getInventorySummary = async (tenantId) => {
  const items = await getInventoryItems(tenantId);
  const atRiskItems = items.filter((item) => item.current_stock <= item.reorder_level);
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

const getBills = async (tenantId, limit, outletId = null, query = {}) => {
  try {
    const data = await billingService.listInvoices({ tenantId, limit, page: query.page, offset: query.offset, from: query.from, to: query.to, outletIds: outletId ? [outletId] : query.outletIds || null });
    const bills = data.map((bill) => toLegacyBillRecord(bill));
    return outletId ? bills.filter((bill) => getBillOutletId(bill) === outletId) : bills;
  } catch (error) {
    throw error;
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
  } catch (error) {
    // A failed sales query must never turn sample or truncated data into owner metrics.
    throw error;
  }
};

const getDashboardStats = async (tenantId, outletId = null, period = "all") => {
  const outlets = await getOutlets(tenantId);
  const outletIds = new Set(outlets.map((outlet) => outlet.id));
  const bills = await getAllRevenueBills(tenantId, outletId);
  const revenueDetail = await buildRevenueAnalytics({ tenantId, bills, period, outletId });
  const allTimeRevenueDetail = period === "all"
    ? revenueDetail
    : await buildRevenueAnalytics({ tenantId, bills, period: "all", outletId });
  const kitchen = await getCentralKitchenSnapshot(tenantId, outletId ? [outletId] : null);
  const inventorySummary = { at_risk_items: kitchen.low_stock_items, expiry_alerts: kitchen.central_inventory.filter((row) => row.expiry_date && daysBetween(row.expiry_date) <= 14), total_wastage_last_30_days: kitchen.central_inventory.reduce((sum, row) => sum + row.wastage_last_30_days, 0) };
  const business = await ensureBusiness({ tenantId });
  const lowStockProducts = await prisma.product.findMany({ where: { businessId: business.id, active: true, stock: { lte: 10 }, ...(outletId ? { outletLinks: { some: { outletId, enabled: true } } } : {}) } });
  const [recipes, cashierCount] = await Promise.all([
    recipeAnalytics({ businessId: business.id, outletId, bills: bills.filter(isRevenueBill), period: getPeriodRange(period) }),
    prisma.user.count({ where: { businessId: business.id, active: true, role: { name: { equals: "Cashier", mode: "insensitive" } }, ...(outletId ? { OR: [{ outletAssignments: { none: {} } }, { outletAssignments: { some: { outletId } } }] } : {}) } }),
  ]);
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
  // Keep closed outlets with revenue history, including fully refunded sales.
  // Empty inactive outlets do not belong in an operational sales ranking.
  const historicalOutletIds = new Set(bills.map(getBillOutletId));
  const salesByOutlet = reportOutlets(outlets, historicalOutletIds, outletId).map((outlet) => {
    const outletBills = revenueBills.filter((bill) => getBillOutletId(bill) === outlet.id);
    return {
      outlet_id: outlet.id,
      outlet_name: outlet.name,
      bills: outletBills.length,
      status: outlet.status || 'active',
      sales: outletBills.reduce((sum, bill) => sum + getBillNetRevenue(bill), 0),
    };
  });

  return {
    total_sales_today: todayBills.reduce((sum, bill) => sum + getBillNetRevenue(bill), 0),
    sales_charts: buildSalesCharts(bills),
    bills_count_today: todayBills.length,
    online_orders_count: onlineOrders.length,
    online_sales: onlineOrders.reduce((sum, bill) => sum + getBillNetRevenue(bill), 0),
    recent_bills: bills.slice(0, 8),
    today_bills: todayBills,
    online_orders_details: onlineOrders,
    recent_online_orders: onlineOrders.slice(0, 8),
    sales_by_outlet: salesByOutlet,
    low_stock_products: lowStockProducts,
    top_selling: Array.from(topSellingMap.values()).sort((left, right) => right.quantity - left.quantity),
    cashier_count: cashierCount,
    total_revenue: allTimeRevenueDetail.revenue,
    revenue_summary: {
      net_sales: allTimeRevenueDetail.net_sales,
      goods_cost: allTimeRevenueDetail.goods_cost,
      gross_profit: allTimeRevenueDetail.gross_profit,
      margin_percent: allTimeRevenueDetail.margin_percent,
      items_without_cost: allTimeRevenueDetail.items_without_cost,
    },
    revenue_detail: revenueDetail,
    inventory_summary: {
      at_risk_count: inventorySummary.at_risk_items.length,
      expiry_alert_count: inventorySummary.expiry_alerts.length,
      wastage_last_30_days: inventorySummary.total_wastage_last_30_days,
      at_risk_items: inventorySummary.at_risk_items,
      expiry_alerts: inventorySummary.expiry_alerts,
    },
    recipe_analytics: recipes,
    central_kitchen: kitchen,
  };
};


const getCentralKitchenSnapshot = (tenantId, outletIds = null) => centralKitchenService.snapshot({ tenantId, outletIds });

router.get("/dashboard/stats", requirePermission("dashboard"), scopeOutletQuery, async (req, res, next) => {
  try {
    res
      .status(200)
      .json(await getDashboardStats(req.context.tenantId, req.query?.outlet_id || null, req.query?.period || "all"));
  } catch (error) {
    next(error);
  }
});

router.get("/bills", requireAnyPermission("billing", "bills", "reports"), async (req, res, next) => {
  try {
    res
      .status(200)
      .json(await getBills(req.context.tenantId, req.query?.limit, req.query?.outlet_id || null, { ...req.query, outletIds: req.context.outletScope }));
  } catch (error) {
    next(error);
  }
});

router.get("/table-reservations", requireAnyPermission("billing", "bills"), async (req, res, next) => {
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

router.post("/table-reservations", requireAnyPermission("billing", "bills"), async (req, res, next) => {
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

router.post("/table-reservations/:reservationId/confirm", requireAnyPermission("billing", "bills"), async (req, res, next) => {
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

router.post("/table-reservations/:reservationId/undo", requireAnyPermission("billing", "bills"), async (req, res, next) => {
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

router.delete("/table-reservations/:reservationId", requireAnyPermission("reservations", "manager_view"), async (req, res, next) => {
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

router.post("/bills", requirePermission("billing"), applyDefaultOutlet, async (req, res, next) => {
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
      user: currentUser,
    });
    const data = await billingService.updateInvoice({
      tenantId: req.context.tenantId,
      invoiceId: created.id,
      initializeFeedback: true,
      payload: {
        feedback_token: signFeedbackToken(created.id),
        feedback_link: `${publicFrontendBase(req)}/feedback/${signFeedbackToken(created.id)}`,
        updated_at: timestamp,
      },
    });
    res.status(201).json(toLegacyBillRecord(data));
  } catch (error) {
    next(error);
  }
});

router.get("/bills/:invoiceId", requireAnyPermission("billing", "bills", "reports"), async (req, res, next) => {
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

router.put("/bills/:invoiceId", requirePermission("billing"), async (req, res, next) => {
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

router.put("/bills/:invoiceId/kitchen-status", requireAnyPermission("kitchen_view", "waiter_view", "manager_view"), async (req, res, next) => {
  try {
    // Kitchen and floor staff may only move the kitchen status; customer and billing details are not theirs to edit.
    const kitchenStatus = req.body?.kitchen_status ?? req.body?.kitchenStatus;
    const otherFields = Object.keys(req.body || {}).filter((key) => !["kitchen_status", "kitchenStatus"].includes(key));
    if (otherFields.length) {
      res.status(409).json({ detail: `Only the kitchen status can be changed here (not: ${otherFields.join(", ")})` });
      return;
    }
    if (kitchenStatus === undefined) {
      res.status(400).json({ detail: "kitchen_status is required" });
      return;
    }
    const data = await billingService.updateInvoice({
      tenantId: req.context.tenantId,
      invoiceId: req.params.invoiceId,
      payload: {
        kitchen_status: kitchenStatus,
        updated_at: nowIso(),
      },
    });
    res.status(200).json(toLegacyBillRecord(data));
  } catch (error) {
    next(error);
  }
});

router.delete("/bills/:invoiceId", requirePermission("billing"), async (req, res, next) => {
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
        from: req.query.from, to: req.query.to, outletId: req.query.outlet_id || req.query.outletId,
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
    const item = await inventoryService.createItem({ tenantId: req.context.tenantId, payload: req.body });
    res.status(201).json(normalizeInventoryItem(item));
  } catch (error) { next(error); }
});

router.put("/inventory/:itemId", async (req, res, next) => {
  try {
    const updated = await inventoryService.updateItem({ tenantId: req.context.tenantId, itemId: req.params.itemId, payload: req.body });
    res.status(200).json(normalizeInventoryItem(updated));
  } catch (error) { next(error); }
});

router.delete("/inventory/:itemId", async (req, res, next) => {
  try {
    const item = await inventoryService.deleteItem({ tenantId: req.context.tenantId, itemId: req.params.itemId });
    res.status(200).json({ id: item.id, name: item.name });
  } catch (error) { next(error); }
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

    const quantity = Number(req.body.quantity);
    const movementType = req.body.movement_type || "adjustment";
    if (!["purchase", "adjustment", "consumption", "wastage", "spoilage", "pilferage"].includes(movementType) ||
      !Number.isFinite(quantity) || quantity === 0 || (movementType !== "adjustment" && quantity < 0)) {
      throw createHttpError({ statusCode: 400, message: "Provide a valid movement type and quantity" });
    }
    const signedQuantity = ["purchase", "adjustment"].includes(movementType) ? quantity : -quantity;
    const movement = await prisma.$transaction(async (tx) => {
      const result = await moveStock({ tx, businessId: business.id, itemId: item.id, quantity: signedQuantity,
        movementType, reason: req.body.reason || "Manual inventory movement",
        expiryDate: req.body.expiry_date || null });
      await admincoreChangeSyncService.notifyChange({ resource: "inventory", action: "movement_recorded",
        tenantId: req.context.tenantId, businessId: business.id, recordId: item.id }, { tx });
      return result.movement;
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

router.get("/shift-swaps", requireAuth, async (req, res, next) => {
  try {
    const requests = await shiftSwapsFor(req.context.businessId);
    // Managers see every request in their business; everyone else sees only their own.
    res.status(200).json(isManagerRole(req.user) ? requests : requests.filter((item) => item.requester_id === req.user.id));
  } catch (error) {
    next(error);
  }
});

router.post("/shift-swaps", requireAuth, async (req, res, next) => {
  try {
    let target = null;
    if (req.body?.target_staff_id) {
      target = await prisma.user.findFirst({
        where: { id: String(req.body.target_staff_id), businessId: req.context.businessId },
        select: { id: true, name: true },
      });
      if (!target) {
        res.status(400).json({ detail: "target_staff_id does not belong to this business" });
        return;
      }
    }
    const swap = {
      id: randomUUID(),
      business_id: req.context.businessId,
      requester_id: req.user.id,
      requester_name: req.user.name || "Staff",
      target_staff_name: target?.name || "Any available staff",
      target_staff_id: target?.id || null,
      requested_for: req.body?.requested_for || nowIso(),
      note: String(req.body?.note || "").slice(0, 500),
      status: "pending",
    };
    await saveShiftSwaps(req.context.businessId, (current) => [swap, ...current]);
    res.status(201).json(swap);
  } catch (error) {
    next(error);
  }
});

router.put("/shift-swaps/:requestId", requireAuth, async (req, res, next) => {
  try {
  const requests = await shiftSwapsFor(req.context.businessId);
  const existing = requests.find((item) => item.id === req.params.requestId);
  if (!existing) {
    res.status(404).json({ detail: "Shift swap not found" });
    return;
  }

  const nextStatus = req.body?.status || existing.status;
  if (!SHIFT_SWAP_STATUSES.has(nextStatus)) {
    res.status(400).json({ detail: `status must be one of: ${[...SHIFT_SWAP_STATUSES].join(", ")}` });
    return;
  }
  // Approving or rejecting is a manager decision; a requester may only withdraw their own request.
  const mayWithdraw = existing.requester_id === req.user.id && nextStatus === "cancelled";
  if (!isManagerRole(req.user) && !mayWithdraw) {
    res.status(403).json({ detail: "Only a manager can decide shift swap requests" });
    return;
  }

  const updated = { ...existing, status: nextStatus, decided_by: req.user.id, decided_at: nowIso() };
  await saveShiftSwaps(req.context.businessId, (current) => current.map((item) => (item.id === updated.id ? updated : item)));
  res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
});

router.get("/central-kitchen", requireAnyPermission("central_kitchen", "inventory", "reports"), async (req, res, next) => {
  try {
    res.set("Cache-Control", "private, no-store");
    res.status(200).json(await getCentralKitchenSnapshot(req.context.tenantId, req.query.outlet_id ? [req.query.outlet_id] : req.context.outletScope));
  } catch (error) {
    next(error);
  }
});

router.get("/customer-analytics", requireAnyPermission("reports", "dashboard"), scopeOutletQuery, async (req, res, next) => {
  try {
    const context = await reportsService.getReportContext({ tenantId: req.context.tenantId, from: req.query.from, to: req.query.to, outletId: req.query.outlet_id || null });
    const profiles = await prisma.customer.findMany({ where: { businessId: context.business.id, anonymizedAt: null }, select: { phone: true, loyaltyPoints: true } });
    res.status(200).json(customerInsights(context.bills, profiles, context.feedback));
  } catch (error) { next(error); }
});

router.post("/central-kitchen/outlets", requireRole("Owner", "Manager"), requirePermission("central_kitchen"), async (req, res, next) => {
  try {
    if (!String(req.body?.name || "").trim()) throw createHttpError({ statusCode: 400, message: "Enter an outlet name" });
    res.status(201).json(await centralKitchenService.outlet({ tenantId: req.context.tenantId, payload: req.body }));
  } catch (error) { next(error); }
});

router.post("/central-kitchen/purchase-orders", requireRole("Owner", "Manager"), requirePermission("central_kitchen"), async (req, res, next) => {
  try {
  res.status(201).json(await centralKitchenService.purchaseOrder({ tenantId: req.context.tenantId, user: req.user, payload: req.body }));
  } catch (error) {
    next(error);
  }
});

// An outlet's stock request: approve (dispatches it from the central store) or reject with a reason.
router.post("/central-kitchen/purchase-orders/:purchaseOrderId/:decision(approve|reject)", requireRole("Owner", "Manager"), requirePermission("central_kitchen"), async (req, res, next) => {
  try {
    res.status(200).json(await centralKitchenService.decidePurchaseOrder({ tenantId: req.context.tenantId, user: req.user, purchaseOrderId: req.params.purchaseOrderId,
      approve: req.params.decision === "approve", reason: req.body?.reason, outletScope: req.context.outletScope }));
  } catch (error) { next(error); }
});

// Delivery route progress: start (in transit) and complete.
router.post("/central-kitchen/routes/:routeId/:action(start|complete)", requireRole("Owner", "Manager"), requirePermission("central_kitchen"), async (req, res, next) => {
  try {
    res.status(200).json(await centralKitchenService.updateRouteStatus({ tenantId: req.context.tenantId, user: req.user, routeId: req.params.routeId,
      action: req.params.action, outletScope: req.context.outletScope }));
  } catch (error) { next(error); }
});

router.post("/central-kitchen/restocks", requireRole("Owner", "Manager"), requirePermission("inventory"), async (req, res, next) => {
  try {
    const transfer = await inventoryOperationsService.createTransferRequest({ tenantId: req.context.tenantId, user: req.user,
      payload: { request_id: req.body.request_id, destination_outlet_id: req.body.outlet_id, items: [{ inventory_id: req.body.inventory_id, quantity: req.body.quantity }] } });
    res.status(201).json({ ...transfer, message: "Transfer requested. Manager approval and outlet receipt are required before stock is available." });
  } catch (error) { next(error); }
});

router.post("/central-kitchen/routes", requireRole("Owner", "Manager"), requirePermission("central_kitchen"), async (req, res, next) => {
  try {
  res.status(201).json(await centralKitchenService.route({ tenantId: req.context.tenantId, payload: req.body }));
  } catch (error) {
    next(error);
  }
});

export default router;


