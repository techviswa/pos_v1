import { readFile } from "fs/promises";
import { randomUUID } from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";

import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import { normalizeBillingMetadata } from "../billing/billing-metadata.utils.js";
import { centralKitchenService } from "../central-kitchen/central-kitchen.service.js";
import { recipeAnalytics } from "../dashboard/recipe-analytics.js";
import { customerInsights, reportCustomerKey } from "./customer-insights.js";
import {
  getAllocatedLineRevenue,
  getBillLineCost,
  getBillChannel,
  getBillOutletId,
  getBillRefundAmount,
  getBillRevenue,
  getBillSubtotal,
  getBillTax,
  isRevenueBill,
  toAnalyticsNumber,
} from "../billing/bill-analytics.utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../../data");
const SCHEDULE_FILE = path.join(DATA_DIR, "scheduled-reports.json");

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const inRange = (date, { from, to } = {}) => {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return false;
  if (from && time < new Date(`${from}T00:00:00Z`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59.999Z`).getTime()) return false;
  return true;
};

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

const normalizeBill = (bill) => ({
  ...normalizeBillingMetadata(bill.metadata || {}),
  metadata: bill.metadata || {},
  id: bill.id,
  invoice_number: bill.invoiceNumber,
  customer_name: bill.customerName,
  subtotal: bill.subtotal,
  tax: bill.tax,
  total: bill.total,
  status: bill.status,
  order: bill.order || null,
  created_at: bill.createdAt.toISOString(),
  updated_at: bill.updatedAt.toISOString(),
  items: bill.items || [],
});

class ReportsService {
  async getReportContext({ tenantId, from, to, outletId = null, context = null }) {
    if (context) return context;
    for (const date of [from, to]) {
      if (date != null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw createHttpError({ statusCode: 400, message: "Report dates must be valid YYYY-MM-DD dates" });
    }
    if (from && to && from > to) throw createHttpError({ statusCode: 400, message: "Report start date must not follow end date" });
    const business = await ensureBusiness({ tenantId });
    const [bills, products, outlets, users, feedback] = await Promise.all([
      prisma.bill.findMany({
        where: { businessId: business.id, ...((from || to) ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86400000) } : {}) } } : {}) },
        include: { items: true, order: { select: { outletId: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.product.findMany({ where: { businessId: business.id } }),
      prisma.outlet.findMany({ where: { businessId: business.id } }),
      prisma.user.findMany({ where: { businessId: business.id }, include: { role: true } }),
      prisma.feedback.findMany({ where: { businessId: business.id }, include: { bill: { select: { metadata: true, order: { select: { outletId: true } } } } } }),
    ]);

    return {
      business,
      bills: bills
        .map(normalizeBill)
        .filter((bill) => !outletId || getBillOutletId(bill) === outletId)
        .filter((bill) => inRange(bill.created_at, { from, to })),
      products,
      outlets,
      users,
      feedback: feedback.filter((row) => inRange(row.createdAt, { from, to }) && (!outletId || (row.bill && getBillOutletId(row.bill) === outletId))),
    };
  }

  async gstTaxReport(input) {
    const { business, bills } = await this.getReportContext(input);
    const rows = bills.filter(isRevenueBill).map((bill) => {
      const gst = bill.gst_breakup || {};
      const taxableValue = getBillSubtotal(bill);
      const taxTotal = getBillTax(bill);
      const splitTotal = toAnalyticsNumber(gst.cgst) + toAnalyticsNumber(gst.sgst) + toAnalyticsNumber(gst.igst);
      const total = getBillRevenue(bill);
      return {
        invoice_number: bill.invoice_number || bill.id,
        date: bill.created_at.slice(0, 10),
        customer_name: bill.customer_name || bill.customerName || "Walk-in",
        taxable_value: taxableValue,
        cgst: splitTotal > 0 ? taxTotal * toAnalyticsNumber(gst.cgst) / splitTotal : taxTotal / 2,
        sgst: splitTotal > 0 ? taxTotal * toAnalyticsNumber(gst.sgst) / splitTotal : taxTotal / 2,
        igst: splitTotal > 0 ? taxTotal * toAnalyticsNumber(gst.igst) / splitTotal : 0,
        tax_total: taxTotal,
        invoice_total: total,
        status: bill.status,
      };
    });

    return {
      business_id: business.id,
      generated_at: new Date().toISOString(),
      summary: rows.reduce(
        (sum, row) => ({
          taxable_value: sum.taxable_value + row.taxable_value,
          cgst: sum.cgst + row.cgst,
          sgst: sum.sgst + row.sgst,
          igst: sum.igst + row.igst,
          tax_total: sum.tax_total + row.tax_total,
          invoice_total: sum.invoice_total + row.invoice_total,
        }),
        { taxable_value: 0, cgst: 0, sgst: 0, igst: 0, tax_total: 0, invoice_total: 0 },
      ),
      rows,
    };
  }

  async productProfitability(input) {
    const { business, bills, products } = await this.getReportContext(input);
    const productById = new Map(products.map((product) => [product.id, product]));
    const rowsByKey = new Map();

    bills.forEach((bill) => {
      (bill.items || []).forEach((item) => {
        const product = productById.get(item.productId);
        const key = item.productId || item.name;
        const row = rowsByKey.get(key) || {
          product_id: item.productId || null,
          name: item.name,
          category: product?.category || "Unmapped",
          quantity_sold: 0,
          revenue: 0,
          cogs: 0,
          estimated_cost: false,
          gross_profit: 0,
          margin_percent: 0,
        };
        const quantity = toAnalyticsNumber(item.quantity, 0);
        row.quantity_sold += quantity;
        row.revenue += isRevenueBill(bill) ? getAllocatedLineRevenue(bill, item) : 0;
        const cost = getBillLineCost(bill, item, product);
        row.cogs += cost.amount;
        row.estimated_cost ||= cost.estimated;
        row.gross_profit = row.revenue - row.cogs;
        row.margin_percent = row.revenue > 0 ? (row.gross_profit / row.revenue) * 100 : 0;
        rowsByKey.set(key, row);
      });
    });

    const rows = Array.from(rowsByKey.values()).sort((left, right) => right.gross_profit - left.gross_profit);
    return {
      business_id: business.id,
      summary: rows.reduce(
        (sum, row) => ({
          quantity_sold: sum.quantity_sold + row.quantity_sold,
          revenue: sum.revenue + row.revenue,
          cogs: sum.cogs + row.cogs,
          gross_profit: sum.gross_profit + row.gross_profit,
        }),
        { quantity_sold: 0, revenue: 0, cogs: 0, gross_profit: 0 },
      ),
      rows,
    };
  }

  async salesByDate(input) {
    const { business, bills } = await this.getReportContext(input);
    const rowsByDate = new Map();
    bills.filter(isRevenueBill).forEach((bill) => {
      const date = bill.created_at.slice(0, 10);
      const row = rowsByDate.get(date) || { date, bills: 0, sales: 0, tax: 0, net: 0, refunds: 0 };
      const tax = getBillTax(bill);
      const revenue = getBillRevenue(bill);
      row.bills += 1;
      row.sales += revenue;
      row.tax += tax;
      row.net += Math.max(0, revenue - tax);
      row.refunds += getBillRefundAmount(bill);
      rowsByDate.set(date, row);
    });
    const rows = Array.from(rowsByDate.values()).sort((a, b) => b.date.localeCompare(a.date));
    return {
      business_id: business.id,
      summary: rows.reduce(
        (sum, row) => ({
          bills: sum.bills + row.bills,
          sales: sum.sales + row.sales,
          tax: sum.tax + row.tax,
          net: sum.net + row.net,
          refunds: sum.refunds + row.refunds,
        }),
        { bills: 0, sales: 0, tax: 0, net: 0, refunds: 0 },
      ),
      rows,
    };
  }

  async hourlySales(input) {
    const { business, bills } = await this.getReportContext(input);
    const rows = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      bills: 0,
      sales: 0,
      tax: 0,
      average_bill: 0,
    }));

    bills.filter(isRevenueBill).forEach((bill) => {
      const hour = new Date(bill.created_at).getUTCHours();
      rows[hour].bills += 1;
      rows[hour].sales += getBillRevenue(bill);
      rows[hour].tax += getBillTax(bill);
      rows[hour].average_bill = rows[hour].bills ? rows[hour].sales / rows[hour].bills : 0;
    });

    return { business_id: business.id, rows };
  }

  async staffPerformance(input) {
    const { business, bills, users } = await this.getReportContext(input);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const rowsById = new Map();

    bills.filter(isRevenueBill).forEach((bill) => {
      const staffId = bill.created_by || "unknown";
      const user = usersById.get(staffId);
      const row = rowsById.get(staffId) || {
        staff_id: staffId,
        name: bill.created_by_name || user?.name || "Unknown",
        role: bill.created_by_role || user?.role?.name || "Unknown",
        bills: 0,
        sales: 0,
        discounts: 0,
        refunds: 0,
        voids: 0,
        average_bill: 0,
      };
      row.bills += 1;
      row.sales += getBillRevenue(bill);
      row.discounts += toAnalyticsNumber(bill.discount_amount, 0);
      row.refunds += getBillRefundAmount(bill);
      row.voids += 0;
      row.average_bill = row.bills ? row.sales / row.bills : 0;
      rowsById.set(staffId, row);
    });

    return { business_id: business.id, rows: Array.from(rowsById.values()).sort((a, b) => b.sales - a.sales) };
  }

  async outletComparison(input) {
    const { business, bills, outlets } = await this.getReportContext(input);
    const outletsById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
    const rowsById = new Map();

    bills.filter(isRevenueBill).forEach((bill) => {
      const outletId = getBillOutletId(bill) || "unassigned";
      const outlet = outletsById.get(outletId);
      const row = rowsById.get(outletId) || {
        outlet_id: outletId,
        outlet_name: outlet?.name || "Unassigned",
        bills: 0,
        sales: 0,
        tax: 0,
        refunds: 0,
        average_bill: 0,
      };
      row.bills += 1;
      row.sales += getBillRevenue(bill);
      row.tax += getBillTax(bill);
      row.refunds += getBillRefundAmount(bill);
      row.average_bill = row.bills ? row.sales / row.bills : 0;
      rowsById.set(outletId, row);
    });

    return { business_id: business.id, rows: Array.from(rowsById.values()).sort((a, b) => b.sales - a.sales) };
  }

  async customerAnalytics(input) {
    const { business, bills, feedback } = await this.getReportContext(input);
    const customerForBill = new Map(bills.map((bill) => [bill.id, reportCustomerKey(bill)]));
    const rowsByCustomer = new Map();
    bills.filter(isRevenueBill).forEach((bill) => {
      const key = reportCustomerKey(bill);
      const row = rowsByCustomer.get(key) || {
        customer_key: key,
        customer_name: bill.customer_name || bill.customerName || "Walk-in",
        customer_phone: bill.customer_phone || null,
        visits: 0,
        total_spent: 0,
        average_spend: 0,
        last_visit: null,
        preferred_channel: getBillChannel(bill) === "online" ? "Online" : "Dine-In",
        feedback_count: 0,
        average_rating: null,
        rated_feedback: 0,
      };
      row.visits += 1;
      row.total_spent += getBillRevenue(bill);
      row.average_spend = row.total_spent / row.visits;
      row.last_visit = !row.last_visit || bill.created_at > row.last_visit ? bill.created_at : row.last_visit;
      rowsByCustomer.set(key, row);
    });

    feedback.forEach((item) => {
      const key = customerForBill.get(item.billId);
      if (!key || !rowsByCustomer.has(key)) return;
      const row = rowsByCustomer.get(key);
      row.feedback_count += 1;
      if (Number.isInteger(item.rating) && item.rating >= 1 && item.rating <= 5) {
        row.average_rating = ((row.average_rating || 0) * row.rated_feedback + item.rating) / (row.rated_feedback + 1);
        row.rated_feedback += 1;
      }
    });

    const rows = Array.from(rowsByCustomer.values()).sort((a, b) => b.total_spent - a.total_spent);
    return {
      business_id: business.id,
      summary: {
        total_customers: rows.length,
        repeat_customers: rows.filter((row) => row.visits > 1).length,
        total_spend: rows.reduce((sum, row) => sum + row.total_spent, 0),
        average_customer_value: rows.length
          ? rows.reduce((sum, row) => sum + row.total_spent, 0) / rows.length
          : 0,
      },
      rows,
    };
  }

  async getDashboard(input) {
    const context = await this.getReportContext(input);
    const scoped = { ...input, context };
    const [sales, gst, profitability, hourly, staff, outlets, customers] = await Promise.all([
      this.salesByDate(scoped),
      this.gstTaxReport(scoped),
      this.productProfitability(scoped),
      this.hourlySales(scoped),
      this.staffPerformance(scoped),
      this.outletComparison(scoped),
      this.customerAnalytics(scoped),
    ]);
    const [kitchen, recipes, profiles] = await Promise.all([
      centralKitchenService.snapshot({ tenantId: input.tenantId, outletIds: input.outletId ? [input.outletId] : null }),
      recipeAnalytics({ businessId: context.business.id, outletId: input.outletId, bills: context.bills.filter(isRevenueBill), period: { ...(input.from ? { start: new Date(`${input.from}T00:00:00Z`) } : {}), ...(input.to ? { end: new Date(Date.parse(`${input.to}T00:00:00Z`) + 86400000) } : {}) } }),
      prisma.customer.findMany({ where: { businessId: context.business.id, anonymizedAt: null }, select: { phone: true, loyaltyPoints: true } }),
    ]);
    const rated = context.feedback.filter((row) => Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5);
    const feedback = { items: context.feedback.map((row) => ({ id: row.id, customer_name: row.customerName || "Guest", rating: row.rating, comment: row.comment || "", created_at: row.createdAt.toISOString() })), summary: { total_feedback: context.feedback.length, rated_feedback: rated.length, average_rating: rated.length ? rated.reduce((sum, row) => sum + row.rating, 0) / rated.length : null, five_star: rated.filter((row) => row.rating === 5).length } };
    return { sales, gst, profitability, hourly, staff, outlets, customers, inventory: kitchen.central_inventory, inventory_location: kitchen.stock_location, recipes, feedback, customer_insights: customerInsights(context.bills, profiles, context.feedback), scope: { from: input.from || null, to: input.to || null, outlet_id: input.outletId || null, timezone: "UTC", inventory: "Current balances; forecast uses last 30 days", loyalty: "Current points held by guests appearing in this period" } };
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
      return {
        filename: `${key}-report.csv`,
        content_type: "text/csv",
        content: toCsv(rows),
      };
    }
    if (format === "pdf") {
      return {
        filename: `${key}-report.html`,
        content_type: "text/html",
        content: `<html><body><h1>${htmlEscape(key)} report</h1><pre>${htmlEscape(JSON.stringify(report, null, 2))}</pre></body></html>`,
      };
    }
    return {
      filename: `${key}-report.json`,
      content_type: "application/json",
      content: JSON.stringify(report, null, 2),
    };
  }

  async readSchedules() {
    try {
      return JSON.parse(await readFile(SCHEDULE_FILE, "utf8"));
    } catch {
      return [];
    }
  }

  async listSchedules({ businessId }) {
    if (!businessId) throw createHttpError({ statusCode: 400, message: "A business is required" });
    const legacy = (await this.readSchedules()).filter((item) => item.business_id === businessId);
    const stored = await prisma.stateDocument.findMany({ where: { key: { startsWith: `report-schedule:${businessId}:` } } });
    return [...new Map([...legacy, ...stored.map((row) => row.data)].map((item) => [item.id, item])).values()];
  }

  async createSchedule({ businessId, payload, user }) {
    if (!businessId) throw createHttpError({ statusCode: 400, message: "A business is required" });
    const item = {
      id: `sch_${randomUUID()}`,
      business_id: businessId,
      report_key: payload.report_key || "gst",
      format: payload.format || "csv",
      frequency: payload.frequency || "daily",
      recipients: payload.recipients || [],
      active: payload.active !== false,
      created_by: user?.id || null,
      created_by_name: user?.name || null,
      created_at: new Date().toISOString(),
      last_run_at: null,
    };
    await prisma.stateDocument.create({ data: { key: `report-schedule:${businessId}:${item.id}`, data: item } });
    return item;
  }

  async runSchedule({ tenantId, businessId, scheduleId }) {
    const schedules = await this.listSchedules({ businessId });
    const schedule = schedules.find((item) => item.id === scheduleId && item.business_id === businessId);
    if (!schedule) return null;
    const exportPayload = await this.exportReport({
      tenantId,
      key: schedule.report_key,
      format: schedule.format,
    });
    schedule.last_run_at = new Date().toISOString();
    schedule.last_export = {
      filename: exportPayload.filename,
      content_type: exportPayload.content_type,
    };
    const key = `report-schedule:${businessId}:${schedule.id}`;
    await prisma.stateDocument.upsert({ where: { key }, create: { key, data: schedule }, update: { data: schedule } });
    return { schedule, export: exportPayload };
  }
}

export const reportsService = new ReportsService();
