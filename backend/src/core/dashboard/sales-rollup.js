import { Prisma } from "@prisma/client";
import { sqlTime } from "../../database/prisma/sql-time.js";
import prisma from "../../database/prisma/client.js";
import { hasActiveTransaction } from "../../database/prisma/rls-runtime.js";
import { scanBills } from "../reports/report-scan.js";
import { addDays, localDate, localDayBounds } from "../../shared/utils/business-time.js";
import {
  getBillChannel,
  getBillLineCost,
  getBillOutletId,
  getBillRevenue,
  getBillSubtotal,
  isRevenueBill,
  toAnalyticsNumber,
} from "../billing/bill-analytics.utils.js";
import { gstTally, hourlyTally, mergeReportDays, profitabilityTally, salesTally, staffTally } from "../reports/report-accumulators.js";

// Saved sales totals per business, local day and outlet, so the dashboard adds up days instead of re-reading every
// bill. A day is recomputed (with the same calculations as Reports) whenever one of its bills was created or changed
// since the last refresh: bill.updatedAt moves on every payment, refund, void or stock reversal.
// Documents: sales-day:<business>:<YYYY-MM-DD> (dashboard totals), report-day:<business>:<YYYY-MM-DD> (the
// Reports tallies of that day per outlet) and sales-rollup:<business> (watermark).

const VERSION = 5;
// Writes still committing when a refresh starts may carry an earlier updatedAt; look back this far every time.
const SAFETY_MS = 5 * 60 * 1000;
const dayKey = (businessId, day) => `sales-day:${businessId}:${day}`;
const reportKey = (businessId, day) => `report-day:${businessId}:${day}`;
const metaKey = (businessId) => `sales-rollup:${businessId}`;
const inFlight = new Map();

const serviceMode = (bill) => {
  const raw = String(bill.service_mode || bill.order_type || "").toUpperCase();
  return /DELIVERY/.test(raw) ? "Delivery" : /PICKUP/.test(raw) ? "Pickup" : /TOKEN|TAKEAWAY/.test(raw) ? "Token / takeaway" : /TABLE|DINE/.test(raw) ? "Table" : "Other / unspecified";
};
const emptyOutlet = () => ({ bills: 0, revenue: 0, net_sales: 0, goods_cost: 0, online_revenue: 0, online_bills: 0, dine_in_revenue: 0, all_bills: 0, missing: [], items: {}, modes: {}, product_bills: {} });

/** Adds one bill to its day's per-outlet totals ("" = no outlet). */
function addBill(days, bill, { timezone, productById, idByName, products, users, reports }) {
  const day = localDate(bill.created_at, timezone);
  const outlets = days.get(day) || {};
  days.set(day, outlets);
  const outletKey = getBillOutletId(bill) || "";
  // The Reports tallies for this day and outlet (same code as a live report, saved as figures).
  const reportDay = reports.get(day) || {};
  reports.set(day, reportDay);
  const tallies = reportDay[outletKey] ||= { sales: salesTally(timezone), hourly: hourlyTally(timezone), profitability: profitabilityTally(products), staff: staffTally(users), gst: gstTally(timezone, { keepRows: false }) };
  for (const tally of Object.values(tallies)) tally.add(bill);
  {
    {
      const outlet = outlets[outletKey] ||= emptyOutlet();
      outlet.all_bills += 1;
      if (!isRevenueBill(bill)) return;
      const revenue = getBillRevenue(bill);
      outlet.bills += 1; outlet.revenue += revenue; outlet.net_sales += getBillSubtotal(bill);
      if (getBillChannel(bill) === "online") { outlet.online_revenue += revenue; outlet.online_bills += 1; } else outlet.dine_in_revenue += revenue;
      const mode = serviceMode(bill);
      outlet.modes[mode] = (outlet.modes[mode] || 0) + revenue;
      for (const item of bill.items || []) {
        const cost = getBillLineCost(bill, item, productById.get(item.productId));
        outlet.goods_cost += cost.amount;
        if (cost.missing && !outlet.missing.includes(item.productId || item.name)) outlet.missing.push(item.productId || item.name);
        outlet.items[item.name] = (outlet.items[item.name] || 0) + toAnalyticsNumber(item.quantity, 0);
      }
      // Bills containing each product (lines without a product id match by name), for recipe analytics.
      const ids = new Set((bill.items || []).map((item) => item.productId || item.product_id || idByName.get(item.name)).filter(Boolean));
      for (const id of ids) outlet.product_bills[id] = (outlet.product_bills[id] || 0) + 1;
    }
  }
}

async function refresh({ businessId, timezone, maxAgeMs = 0 }) {
  const started = Date.now();
  const meta = (await prisma.stateDocument.findUnique({ where: { key: metaKey(businessId) } }))?.data;
  const rebuild = !meta || meta.version !== VERSION || meta.timezone !== timezone;
  // A caller may accept totals checked within maxAgeMs (the dashboard: 15 s); Reports always check.
  if (!rebuild && maxAgeMs > 0 && started - Date.parse(meta.checked_at || meta.refreshed_at) < maxAgeMs) return { recomputed_days: 0, rebuilt: false, reused: true };
  const days = new Set();
  if (rebuild) {
    await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `sales-day:${businessId}:` } } });
    await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `report-day:${businessId}:` } } });
    const rows = await prisma.$queryRaw(Prisma.sql`SELECT DISTINCT (b."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::date::text AS day FROM "Bill" b WHERE b."businessId" = ${businessId}`);
    for (const row of rows) days.add(row.day);
  } else {
    const since = new Date(Date.parse(meta.refreshed_at) - SAFETY_MS);
    const rows = await prisma.$queryRaw(Prisma.sql`SELECT DISTINCT (b."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::date::text AS day FROM "Bill" b WHERE b."businessId" = ${businessId} AND b."updatedAt" >= ${sqlTime(since)}`);
    for (const row of rows) days.add(row.day);
  }
  if (days.size) {
    const [products, users] = await Promise.all([
      prisma.product.findMany({ where: { businessId } }),
      prisma.user.findMany({ where: { businessId }, include: { role: true } }),
    ]);
    const reports = new Map([...days].map((day) => [day, {}]));
    const context = { timezone, products, users, reports, productById: new Map(products.map((product) => [product.id, product])), idByName: new Map(products.map((product) => [product.name, product.id])) };
    const totals = new Map([...days].map((day) => [day, {}]));
    if (rebuild) {
      // First build: one pass over every bill.
      await scanBills({ businessId }, (bills) => { for (const bill of bills) addBill(totals, bill, context); });
    } else {
      for (const day of days) await scanBills({ businessId, bounds: localDayBounds({ from: day, to: day }, timezone) }, (bills) => { for (const bill of bills) addBill(totals, bill, context); });
    }
    for (const [day, outlets] of totals) {
      const data = { business_id: businessId, day, outlets };
      await prisma.stateDocument.upsert({ where: { key: dayKey(businessId, day) }, create: { key: dayKey(businessId, day), data }, update: { data } });
      const figures = Object.fromEntries(Object.entries(reports.get(day) || {}).map(([outlet, tallies]) => [outlet, Object.fromEntries(Object.entries(tallies).map(([name, tally]) => [name, tally.result()]))]));
      const report = { business_id: businessId, day, outlets: figures };
      await prisma.stateDocument.upsert({ where: { key: reportKey(businessId, day) }, create: { key: reportKey(businessId, day), data: report }, update: { data: report } });
    }
  }
  const data = { business_id: businessId, version: VERSION, timezone, refreshed_at: new Date(started).toISOString(), checked_at: new Date(started).toISOString() };
  await prisma.stateDocument.upsert({ where: { key: metaKey(businessId) }, create: { key: metaKey(businessId), data }, update: { data } });
  return { recomputed_days: days.size, rebuilt: rebuild };
}

/** Brings the saved days up to date (one refresh per business at a time in this process). */
export function refreshSalesRollup({ businessId, timezone, maxAgeMs = 0 }) {
  const key = `${businessId}:${timezone}`;
  if (!inFlight.has(key)) inFlight.set(key, refresh({ businessId, timezone, maxAgeMs }).finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

/**
 * Totals from the saved days for local days from..to (inclusive, either open) and one outlet or all.
 * Returns per-day rows too (for charts).
 */
export async function readSalesRollup({ businessId, timezone, from = null, to = null, outletId = null, refresh: refreshFirst = true }) {
  return summarizeSalesDays(await loadSalesDays({ businessId, timezone, refresh: refreshFirst }), { businessId, from, to, outletId });
}

/** The saved day documents of a business (brought up to date first unless refresh is false). */
export async function loadSalesDays({ businessId, timezone, refresh: refreshFirst = true, maxAgeMs = 0 }) {
  // Never refresh inside another transaction (a refresh may outlast it); read the saved days as they are.
  if (refreshFirst && !hasActiveTransaction()) await refreshSalesRollup({ businessId, timezone, maxAgeMs });
  return prisma.stateDocument.findMany({ where: { key: { startsWith: `sales-day:${businessId}:` } }, select: { data: true } });
}

/** Totals of loaded day documents for local days from..to (inclusive, either open) and one outlet or all. */
export function summarizeSalesDays(docs, { businessId, from = null, to = null, outletId = null }) {
  const totals = { bills: 0, revenue: 0, net_sales: 0, goods_cost: 0, online_revenue: 0, online_bills: 0, dine_in_revenue: 0, all_bills: 0 };
  const missing = new Set(), items = new Map(), byOutlet = new Map(), byDay = new Map(), modes = new Map(), productBills = new Map();
  for (const { data } of docs) {
    if (data?.business_id !== businessId || (from && data.day < from) || (to && data.day > to)) continue;
    for (const [outlet, row] of Object.entries(data.outlets || {})) {
      if (outletId && outlet !== outletId) continue;
      for (const field of Object.keys(totals)) totals[field] += row[field] || 0;
      for (const key of row.missing || []) missing.add(key);
      for (const [name, quantity] of Object.entries(row.items || {})) items.set(name, (items.get(name) || 0) + quantity);
      for (const [mode, sales] of Object.entries(row.modes || {})) modes.set(mode, (modes.get(mode) || 0) + sales);
      for (const [id, count] of Object.entries(row.product_bills || {})) productBills.set(id, (productBills.get(id) || 0) + count);
      const outletRow = byOutlet.get(outlet) || { bills: 0, revenue: 0, all_bills: 0 };
      outletRow.bills += row.bills; outletRow.revenue += row.revenue; outletRow.all_bills += row.all_bills;
      byOutlet.set(outlet, outletRow);
      const dayRow = byDay.get(data.day) || { date: data.day, sales: 0, bills: 0 };
      dayRow.sales += row.revenue; dayRow.bills += row.bills;
      byDay.set(data.day, dayRow);
    }
  }
  const grossProfit = totals.net_sales - totals.goods_cost;
  return {
    ...totals,
    gross_profit: grossProfit,
    margin_percent: totals.net_sales ? (grossProfit / totals.net_sales) * 100 : 0,
    items_without_cost: missing.size,
    items: [...items].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity),
    outlets: byOutlet,
    days: byDay,
    modes: [...modes].map(([name, sales]) => ({ name, sales })),
    product_bills: productBills,
  };
}

/** The last 30 local days ending today, quiet days included (the dashboard chart). */
export function last30Days(rollupDays, today) {
  const rows = Array.from({ length: 30 }, (_, index) => {
    const date = addDays(today, index - 29);
    const row = rollupDays.get(date);
    return { date, sales: row?.sales || 0, bills: row?.bills || 0 };
  });
  return rows;
}

export const localToday = (timezone) => localDate(new Date(), timezone);

/** Reports figures (sales, hourly, products, staff, outlets, GST totals) for local days from..to, from the saved days. */
export async function readReportRollup({ businessId, timezone, from, to, outletId = null, outlets = [] }) {
  if (!hasActiveTransaction()) await refreshSalesRollup({ businessId, timezone });
  const docs = await prisma.stateDocument.findMany({ where: { key: { gte: reportKey(businessId, from), lte: reportKey(businessId, to) } }, select: { data: true } });
  const days = [];
  for (const { data } of docs) {
    if (data?.business_id !== businessId || data.day < from || data.day > to) continue;
    for (const [outlet, figures] of Object.entries(data.outlets || {})) {
      if (outletId && outlet !== outletId) continue;
      days.push({ day: data.day, outlet, ...figures, hourly: figures.hourly.rows, profitability: figures.profitability.rows, staff: figures.staff.rows, sales: figures.sales.summary });
    }
  }
  return mergeReportDays(days, outlets);
}

/**
 * Brings every business's saved days up to date in the background (after a deploy that changes the saved format,
 * the first build reads the whole history once). Requests wait only for their own business if it is still running.
 */
export async function warmSalesRollups({ log = () => {} } = {}) {
  const { runTenantScope } = await import("../../database/prisma/tenant-context.js");
  const { readBusinessProfile } = await import("../businesses/business-profile.js");
  const { businessTimezone } = await import("../reports/report-scan.js");
  const businesses = await prisma.business.findMany({ select: { id: true, tenantId: true } });
  for (const business of businesses) {
    try {
      await runTenantScope({ businessId: business.id, tenantId: business.tenantId }, async () => {
        const timezone = businessTimezone(await readBusinessProfile(business.id));
        const result = await refreshSalesRollup({ businessId: business.id, timezone });
        if (result.recomputed_days) log(`Sales totals for ${business.id}: ${result.recomputed_days} day(s) ${result.rebuilt ? "built" : "refreshed"}`);
      });
    } catch (error) { log(`Sales totals for ${business.id} could not be refreshed: ${error.message}`); }
  }
}

/** Starts the background warm-up a few seconds after start-up (SALES_ROLLUP_WARMUP=off disables it). */
export function startSalesRollupWarmup({ logger }) {
  if (String(process.env.SALES_ROLLUP_WARMUP || "").toLowerCase() === "off") return;
  setTimeout(() => warmSalesRollups({ log: (message) => logger.info(message) }).catch((error) => logger.warn(`Sales totals warm-up failed: ${error.message}`)), 5000).unref?.();
}

/** The newest local days (desc) holding at least `count` online orders, from loaded day documents (null if none). */
export function onlineWindow(docs, { businessId, outletId = null, count }) {
  const byDay = new Map();
  for (const { data } of docs) {
    if (data?.business_id !== businessId) continue;
    for (const [outlet, row] of Object.entries(data.outlets || {})) if (!outletId || outlet === outletId) byDay.set(data.day, (byDay.get(data.day) || 0) + (row.online_bills || 0));
  }
  let found = 0;
  for (const day of [...byDay.keys()].sort().reverse()) {
    found += byDay.get(day);
    if (found >= count) return day;
  }
  return found ? [...byDay.keys()].sort()[0] : null;
}
