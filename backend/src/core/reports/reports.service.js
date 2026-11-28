import { createReportSchedules } from "./report-schedules.js";

import prisma from "../../database/prisma/client.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import { readBusinessProfile } from "../businesses/business-profile.js";
import { centralKitchenService } from "../central-kitchen/central-kitchen.service.js";
import { recipeAnalytics } from "../dashboard/recipe-analytics.js";
import { getBillOutletId } from "../billing/bill-analytics.utils.js";
import { MAX_DETAIL_DAYS, businessTimezone, reportRange, scanBills } from "./report-scan.js";
import { readReportRollup, readSalesRollup } from "../dashboard/sales-rollup.js";
import {
  customerInsightsTally,
  customerTally,
  gstTally,
  hourlyTally,
  outletTally,
  productInvoiceTally,
  profitSummaryTally,
  profitabilityTally,
  salesTally,
  staffTally,
} from "./report-accumulators.js";

const csvEscape = (value) => {
  const text = String(value ?? "");
  // Spreadsheet applications evaluate formulas even inside quoted CSV cells.
  const safe = typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
const htmlEscape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const toCsv = (rows = []) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n");
};

class ReportsService {
  /**
   * Everything a report needs except the bills: the business, its calendar, the validated period (local days,
   * at most 366) and the reference lists. Bills are then streamed with scan().
   */
  async prepare({ tenantId, from, to, outletId = null }, maxDays) {
    const business = await ensureBusiness({ tenantId });
    const timezone = businessTimezone(await readBusinessProfile(business.id));
    const range = reportRange({ from, to }, timezone, maxDays);
    return { business, timezone, range, outletId };
  }

  async scan(context, tallies) {
    const list = Object.values(tallies);
    const billCount = await scanBills({ businessId: context.business.id, bounds: context.range.bounds, outletId: context.outletId }, (bills) => {
      for (const bill of bills) for (const tally of list) tally.add(bill);
    });
    return { billCount, ...Object.fromEntries(Object.entries(tallies).map(([key, tally]) => [key, tally.result()])) };
  }

  scope(context) {
    return { from: context.range.from, to: context.range.to, days: context.range.days, defaulted: context.range.defaulted, outlet_id: context.outletId || null, timezone: context.timezone };
  }

  /** Feedback of the period (and outlet), keyed by bill. */
  async feedbackFor(context) {
    const rows = await prisma.feedback.findMany({
      where: { businessId: context.business.id, createdAt: context.range.bounds },
      include: { bill: { select: { metadata: true, order: { select: { outletId: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.filter((row) => !context.outletId || (row.bill && getBillOutletId(row.bill) === context.outletId));
  }

  /** Sums from the saved days (same tallies, computed when the bills were last changed). */
  async summed(input) {
    const context = await this.prepare(input);
    const outlets = await prisma.outlet.findMany({ where: { businessId: context.business.id } });
    const figures = await readReportRollup({ businessId: context.business.id, timezone: context.timezone, from: context.range.from, to: context.range.to, outletId: context.outletId, outlets });
    return { context, figures };
  }

  async fromDays(input, section) {
    const { context, figures } = await this.summed(input);
    return { business_id: context.business.id, ...figures[section], scope: this.scope(context) };
  }

  async single(input, makeTally) {
    const context = await this.prepare(input, MAX_DETAIL_DAYS);
    const tally = await makeTally(context);
    const { report } = await this.scan(context, { report: tally });
    return { business_id: context.business.id, ...report, scope: this.scope(context) };
  }

  gstTaxReport(input) { return this.single(input, (context) => gstTally(context.timezone)).then((report) => ({ ...report, generated_at: new Date().toISOString() })); }
  salesByDate(input) { return this.fromDays(input, "sales"); }
  hourlySales(input) { return this.fromDays(input, "hourly"); }
  productProfitability(input) { return this.fromDays(input, "profitability"); }
  staffPerformance(input) { return this.fromDays(input, "staff"); }
  outletComparison(input) { return this.fromDays(input, "outlets"); }
  async customerAnalytics(input) {
    return this.single(input, async (context) => {
      const byBill = new Map();
      for (const row of await this.feedbackFor(context)) byBill.set(row.billId, [...(byBill.get(row.billId) || []), row.rating]);
      return customerTally(byBill);
    });
  }

  /** Guests, favourites and item sales by channel for the period (Reports > Customers). */
  async customerInsights(input) {
    const context = await this.prepare(input, MAX_DETAIL_DAYS);
    const [profiles, feedback] = await Promise.all([
      prisma.customer.findMany({ where: { businessId: context.business.id, anonymizedAt: null }, select: { phone: true, loyaltyPoints: true } }),
      this.feedbackFor(context),
    ]);
    const { insights } = await this.scan(context, { insights: customerInsightsTally(profiles, feedback.map((row) => row.rating)) });
    return { ...insights, scope: this.scope(context) };
  }

  /**
   * Profit for a window of instants [start, end) as the dashboard shows it; same calculation as productProfitability.
   * keepBills adds per-bill figures (only for small windows).
   */
  async profitSummary({ tenantId, outletId = null, start = null, end = null, keepBills = false }) {
    const business = await ensureBusiness({ tenantId });
    const tally = profitSummaryTally(await prisma.product.findMany({ where: { businessId: business.id } }), { keepBills });
    await scanBills({ businessId: business.id, bounds: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) }, outletId }, (bills) => { for (const bill of bills) tally.add(bill); });
    return tally.result();
  }

  async getDashboard(input) {
    const { context, figures } = await this.summed(input);
    const businessId = context.business.id;
    const detailed = input.guests !== false && context.range.days <= MAX_DETAIL_DAYS;
    const [feedbackRows, profiles, sales] = await Promise.all([
      this.feedbackFor(context),
      detailed ? prisma.customer.findMany({ where: { businessId, anonymizedAt: null }, select: { phone: true, loyaltyPoints: true } }) : [],
      readSalesRollup({ businessId, timezone: context.timezone, from: context.range.from, to: context.range.to, outletId: context.outletId, refresh: false }),
    ]);
    // Guests can only be counted by reading the period's bills (a guest repeats across days), so the guest
    // sections are computed for periods up to 92 days and say so otherwise.
    let guests = null;
    if (detailed) {
      const ratingsByBill = new Map();
      for (const row of feedbackRows) ratingsByBill.set(row.billId, [...(ratingsByBill.get(row.billId) || []), row.rating]);
      guests = await this.scan(context, { customers: customerTally(ratingsByBill), customer_insights: customerInsightsTally(profiles, feedbackRows.map((row) => row.rating)) });
    }
    const unavailable = input.guests === false
      ? { available: false, deferred: true, message: "Guest analytics load separately.", summary: {}, rows: [], customers: [], item_sales_by_channel: [], campaign_suggestions: [] }
      : { available: false, message: `Guest analytics cover at most ${MAX_DETAIL_DAYS} days. Choose a shorter period.`, summary: {}, rows: [], customers: [], item_sales_by_channel: [], campaign_suggestions: [] };
    const [kitchen, recipes] = await Promise.all([
      centralKitchenService.snapshot({ tenantId: input.tenantId, outletIds: context.outletId ? [context.outletId] : null }),
      recipeAnalytics({ businessId, outletId: context.outletId, invoiceCounts: sales.product_bills, period: { start: context.range.bounds.gte, end: context.range.bounds.lt } }),
    ]);
    const rated = feedbackRows.filter((row) => Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5);
    const feedback = { items: feedbackRows.map((row) => ({ id: row.id, customer_name: row.customerName || "Guest", rating: row.rating, comment: row.comment || "", created_at: row.createdAt.toISOString() })), summary: { total_feedback: feedbackRows.length, rated_feedback: rated.length, average_rating: rated.length ? rated.reduce((sum, row) => sum + row.rating, 0) / rated.length : null, five_star: rated.filter((row) => row.rating === 5).length } };
    const id = { business_id: businessId };
    return {
      sales: { ...id, ...figures.sales }, gst: { ...id, ...figures.gst }, profitability: { ...id, ...figures.profitability }, hourly: { ...id, ...figures.hourly },
      staff: { ...id, ...figures.staff }, outlets: { ...id, ...figures.outlets }, customers: { ...id, ...(guests ? guests.customers : unavailable) },
      inventory: kitchen.central_inventory, inventory_location: kitchen.stock_location, recipes, feedback, customer_insights: guests ? guests.customer_insights : unavailable,
      scope: { ...this.scope(context), bills: sales.all_bills, inventory: "Current balances; forecast uses last 30 days", loyalty: "Current points held by guests appearing in this period" },
    };
  }

  async getReportByKey(key, input) {
    const map = {
      gst: () => this.gstTaxReport(input),
      tax: () => this.gstTaxReport(input),
      sales: () => this.salesByDate(input),
      date: () => this.salesByDate(input),
      profitability: () => this.productProfitability(input),
      products: () => this.productProfitability(input),
      hourly: () => this.hourlySales(input),
      staff: () => this.staffPerformance(input),
      outlets: () => this.outletComparison(input),
      customers: () => this.customerAnalytics(input),
    };
    return (map[key] || map.gst)();
  }

  async exportReport({ key, format = "json", ...input }) {
    const report = await this.getReportByKey(key, input);
    const rows = report.rows || [];
    if (format === "csv" || format === "excel") {
      return { filename: `${key}-report.csv`, content_type: "text/csv", content: toCsv(rows) };
    }
    if (format === "pdf") {
      return { filename: `${key}-report.html`, content_type: "text/html", content: `<html><body><h1>${htmlEscape(key)} report</h1><pre>${htmlEscape(JSON.stringify(report, null, 2))}</pre></body></html>` };
    }
    return { filename: `${key}-report.json`, content_type: "application/json", content: JSON.stringify(report, null, 2) };
  }
}

export const reportsService = new ReportsService();
export const reportSchedules = createReportSchedules({ reports: reportsService });
