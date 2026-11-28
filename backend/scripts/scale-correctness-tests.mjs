// Scale-safe reporting: business calendar (time zone), saved daily totals that follow every bill change, range
// limits, totals over every bill (not a page), outlet-restricted paging and time-zone-safe SQL timestamps.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { runTenantScope } from "../src/database/prisma/tenant-context.js";
import { sqlTime } from "../src/database/prisma/sql-time.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { usersService } from "../src/core/users/users.service.js";
import { reportsService } from "../src/core/reports/reports.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { updateBusinessProfile, readBusinessProfile } from "../src/core/businesses/business-profile.js";
import { readSalesRollup } from "../src/core/dashboard/sales-rollup.js";
import { reportPeriod, isDue } from "../src/core/reports/report-schedules.js";
import { localDate, localHour, startOfLocalDay, localDayBounds } from "../src/shared/utils/business-time.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8), id = `scale-${suffix}`, tenantId = `tenant-${id}`;
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = async (promise, pattern, message) => { await assert.rejects(promise, (error) => pattern.test(`${error.code} ${error.message}`), message); checks++; };
const near = (actual, expected, message) => { assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`); checks++; };
try {
  await connectDatabase();
  // Calendar helpers: India and a daylight-saving zone.
  eq(startOfLocalDay("2026-11-28").toISOString(), "2026-11-27T18:30:00.000Z");
  eq([localDate("2026-11-10T20:00:00Z"), localHour("2026-11-10T20:00:00Z")], ["2026-11-11", 1], "01:30 in India is the next day");
  eq(startOfLocalDay("2026-03-09", "America/New_York").toISOString(), "2026-03-09T04:00:00.000Z", "after the clocks change");
  eq(reportPeriod("daily", new Date("2026-12-01T19:00:00Z")), { from: "2026-12-01", to: "2026-12-01" }, "00:30 on 2 Dec in India reports 1 Dec");
  eq(isDue({ frequency: "daily", active: true }, new Date("2026-12-01T00:00:00Z")), false, "05:30 local: before 07:00 local");
  eq(isDue({ frequency: "monthly", active: true }, new Date("2026-12-01T02:00:00Z")), true, "07:30 on the local 1st");
  eq(isDue({ frequency: "monthly", active: true }, new Date("2026-11-30T20:00:00Z")), false, "01:30 on the local 1st is before 07:00");

  await prisma.business.create({ data: { id, tenantId, name: "Scale correctness" } });
  await saasService.updateSubscription({ businessId: id, payload: { plan: "growth", subscription_status: "active" } });
  const [main, second] = await Promise.all(["Main", "Second"].map((name, index) => prisma.outlet.create({ data: { businessId: id, name, code: `SC${index}${suffix}` } })));
  const product = await prisma.product.create({ data: { businessId: id, name: "Coffee", category: "Drinks", price: 100, costPrice: 40, stock: 1000 } });
  const bill = (createdAt, outlet, total = 105, extra = {}) => prisma.bill.create({ data: { businessId: id, customerName: "Walk-in", currency: "INR", subtotal: total / 1.05, tax: total - total / 1.05, total, status: "paid",
    invoiceNumber: `SC-${randomUUID().slice(0, 8)}`, createdAt, metadata: { outlet_id: outlet.id, payments: [{ method: "Cash", amount: total, status: "confirmed" }], ...extra },
    items: { create: [{ productId: product.id, name: "Coffee", quantity: 1, price: total / 1.05 }] } } });
  const late = await bill(new Date("2026-11-10T20:00:00Z"), main);          // 01:30 on 11 Nov in India
  const lunch = await bill(new Date("2026-11-11T07:30:00Z"), main, 210);    // 13:00 on 11 Nov
  await bill(new Date("2026-11-11T09:00:00Z"), second, 52.5);               // 14:30 on 11 Nov, other outlet
  const scope = (work) => runTenantScope({ businessId: id, tenantId }, work);

  await scope(async () => {
    const day = { tenantId, from: "2026-11-11", to: "2026-11-11" };
    const sales = await reportsService.salesByDate(day);
    eq([sales.summary.bills, sales.rows.map((row) => row.date)], [3, ["2026-11-11"]], "the 01:30 bill counts on its local day");
    near(sales.summary.sales, 367.5, "sales of the day");
    const hourly = await reportsService.hourlySales(day);
    eq([hourly.rows[1].bills, hourly.rows[13].bills, hourly.rows[14].bills, hourly.rows[7].bills], [1, 1, 1, 0], "hours are local (lunch at 13:00, not 07:00)");
    eq((await reportsService.outletComparison({ ...day, outletId: second.id })).rows.map((row) => row.outlet_name), ["Second"], "outlet filter");
    eq((await reportsService.salesByDate({ tenantId, from: "2026-11-10", to: "2026-11-10" })).summary.bills, 0, "nothing on the UTC day the late bill was stored under");

    // A refund on an old day moves that day's saved totals; a void removes the bill.
    await prisma.bill.update({ where: { id: lunch.id }, data: { metadata: { ...lunch.metadata, refunded_amount: 110 } } });
    near((await reportsService.salesByDate(day)).summary.sales, 257.5, "refund reflected");
    near((await reportsService.salesByDate(day)).summary.refunds, 110, "refund total");
    await prisma.bill.update({ where: { id: late.id }, data: { status: "void" } });
    eq((await reportsService.salesByDate(day)).summary.bills, 2, "void reflected");
    const totals = await readSalesRollup({ businessId: id, timezone: "Asia/Kolkata" });
    near(totals.revenue, 152.5, "dashboard all-time totals follow the same changes");
    // Overview and the live per-bill reports agree.
    const overview = await reportsService.getDashboard(day);
    near(overview.sales.summary.sales, 152.5, "overview sales");
    eq(overview.customers.summary.walk_in_visits, 2, "walk-ins are counted as visits");
    eq(overview.customers.rows.filter((row) => row.anonymous).length, 1, "walk-ins share one row");
    eq((await reportsService.gstTaxReport(day)).rows.length, 2, "GST rows for live bills");

    // Ranges: at most 366 days for summed reports, 92 for bill-by-bill ones; long overviews say guests are unavailable.
    await rejects(reportsService.salesByDate({ tenantId, from: "2025-01-01", to: "2026-11-11" }), /REPORT_RANGE_TOO_LONG/);
    await rejects(reportsService.gstTaxReport({ tenantId, from: "2026-01-01", to: "2026-11-11" }), /REPORT_RANGE_TOO_LONG/);
    const long = await reportsService.getDashboard({ tenantId, from: "2026-01-01", to: "2026-11-11" });
    eq([long.customers.available, long.sales.summary.bills], [false, 2], "a 315-day overview has sales but no guest scan");
    await rejects(reportsService.salesByDate({ tenantId, from: "2026-11-12", to: "2026-11-11" }), /must not follow/);

    // Changing the time zone rebuilds the saved days on the new calendar.
    const profile = await readBusinessProfile(id);
    await rejects(updateBusinessProfile(id, { timezone: "Mars/Olympus", expected_updated_at: profile.updated_at }), /BUSINESS_PROFILE_INVALID/);
    await updateBusinessProfile(id, { timezone: "Europe/London", expected_updated_at: profile.updated_at });
    eq((await reportsService.salesByDate({ tenantId, from: "2026-11-11", to: "2026-11-11" })).summary.bills, 2, "London: both live bills are on 11 Nov");
    eq((await reportsService.hourlySales({ tenantId, from: "2026-11-11", to: "2026-11-11" })).rows[7].bills, 1, "London: the lunch bill is at 07:00");

    // Billing summary covers every bill, not the newest page.
    const many = Array.from({ length: 150 }, (_, n) => ({ businessId: id, customerName: "Walk-in", currency: "INR", subtotal: 10, tax: 0, total: 10, status: "paid", invoiceNumber: `SCM-${suffix}-${n}`, createdAt: new Date(Date.UTC(2026, 10, 20, 6, n)), metadata: { outlet_id: second.id } }));
    await prisma.bill.createMany({ data: many });
    const summary = await billingService.getBillingSummary({ tenantId });
    eq(summary.invoiceCount, 153, "every bill counted");
    near(summary.revenue, 1652.5, "revenue after the refund and the void");

    // Outlet-restricted lists page in the database and use local days.
    const page1 = await billingService.listInvoices({ tenantId, limit: 50, outletIds: [second.id] });
    const page4 = await billingService.listInvoices({ tenantId, limit: 50, page: 4, outletIds: [second.id] });
    eq([page1.length, page4.length], [50, 1], "151 bills of the outlet in pages of 50");
    eq((await billingService.listInvoices({ tenantId, limit: 50, outletIds: [main.id], from: "2026-11-11", to: "2026-11-11" })).length, 1, "London days: the 01:30-India bill is on 10 Nov, so main has only the lunch bill on 11 Nov");
    eq((await billingService.listInvoices({ tenantId, limit: 50, outletIds: [] })).length, 0, "no outlets, no bills");

    // Raw SQL timestamps mean UTC whatever the database session's time zone is.
    const bounds = localDayBounds({ from: "2026-11-20", to: "2026-11-20" }, "Asia/Kolkata");
    const [raw] = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "Bill" WHERE "businessId" = ${id} AND "createdAt" >= ${sqlTime(bounds.gte)} AND "createdAt" < ${sqlTime(bounds.lt)}`;
    eq(raw.n, await prisma.bill.count({ where: { businessId: id, createdAt: bounds } }), "raw SQL and Prisma agree on the window");
  });
  console.log(`Scale correctness passed (${checks} checks): local days and hours, saved totals follow refunds/voids/time-zone changes, range limits, whole-history totals, outlet paging, UTC-safe SQL timestamps.`);
} finally {
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
