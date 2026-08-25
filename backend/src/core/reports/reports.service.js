import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import prisma from "../../database/prisma/client.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import { normalizeBillingMetadata } from "../billing/billing-metadata.utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../../data");
const SCHEDULE_FILE = path.join(DATA_DIR, "scheduled-reports.json");

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const inRange = (date, { from, to } = {}) => {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return false;
  if (from && time < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
};

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const toCsv = (rows = []) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n");
};

const normalizeBill = (bill) => ({
  ...normalizeBillingMetadata(bill.metadata || {}),
  id: bill.id,
  customer_name: bill.customerName,
  subtotal: bill.subtotal,
  tax: bill.tax,
  total: bill.total,
  status: bill.status,
  created_at: bill.createdAt.toISOString(),
  updated_at: bill.updatedAt.toISOString(),
  items: bill.items || [],
});

const isRevenueBill = (bill) => !["void", "cancelled", "canceled"].includes(String(bill.status || "").toLowerCase());
const billRefundAmount = (bill) => toNumber(bill.refunded_amount, 0);
const billRevenue = (bill) => Math.max(0, toNumber(bill.total, 0) - billRefundAmount(bill));
const billTax = (bill) => {
  const total = toNumber(bill.total, 0);
  const revenue = billRevenue(bill);
  const ratio = total > 0 ? revenue / total : 0;
  return toNumber(bill.tax, 0) * ratio;
};
const billSubtotal = (bill) => {
  const total = toNumber(bill.total, 0);
  const revenue = billRevenue(bill);
  const ratio = total > 0 ? revenue / total : 0;
  return toNumber(bill.subtotal, 0) * ratio;
};
const lineGrossTotal = (bill) =>
  (bill.items || []).reduce((sum, item) => sum + toNumber(item.quantity, 0) * toNumber(item.price, 0), 0);
const allocatedLineRevenue = (bill, item) => {
  const gross = lineGrossTotal(bill);
  const lineGross = toNumber(item.quantity, 0) * toNumber(item.price, 0);
  return gross > 0 ? billRevenue(bill) * (lineGross / gross) : 0;
};
const billChannel = (bill) =>
  String(bill.order_type || bill.service_mode || bill.payment_type || "")
    .toLowerCase()
    .match(/online|website|web|delivery|swiggy|zomato|qr/)
    ? "online"
    : "inhouse";

class ReportsService {
  async getReportContext({ tenantId, from, to, outletId = null }) {
    const business = await ensureBusiness({ tenantId });
    const [bills, products, outlets, users, feedback] = await Promise.all([
      prisma.bill.findMany({
        where: { businessId: business.id },
        include: { items: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.product.findMany({ where: { businessId: business.id } }),
      prisma.outlet.findMany({ where: { businessId: business.id } }),
      prisma.user.findMany({ where: { businessId: business.id }, include: { role: true } }),
      prisma.feedback.findMany({ where: { businessId: business.id } }),
    ]);

    return {
      business,
      bills: bills
        .map(normalizeBill)
        .filter((bill) => !outletId || bill.outlet_id === outletId)
        .filter((bill) => inRange(bill.created_at, { from, to })),
      products,
      outlets,
      users,
      feedback,
    };
  }

  async gstTaxReport(input) {
    const { business, bills } = await this.getReportContext(input);
    const rows = bills.filter(isRevenueBill).map((bill) => {
      const gst = bill.gst_breakup || {};
      const taxableValue = billSubtotal(bill);
      const taxTotal = billTax(bill);
      const total = billRevenue(bill);
      return {
        invoice_number: bill.invoice_number || bill.id,
        date: bill.created_at.slice(0, 10),
        customer_name: bill.customer_name || bill.customerName || "Walk-in",
        taxable_value: taxableValue || toNumber(gst.taxable_value, bill.subtotal),
        cgst: taxTotal ? taxTotal / 2 : toNumber(gst.cgst, bill.tax / 2),
        sgst: taxTotal ? taxTotal / 2 : toNumber(gst.sgst, bill.tax / 2),
        igst: toNumber(gst.igst, 0),
        tax_total: taxTotal || toNumber(gst.tax_total, bill.tax),
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

    bills.filter(isRevenueBill).forEach((bill) => {
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
          gross_profit: 0,
          margin_percent: 0,
        };
        const quantity = toNumber(item.quantity, 0);
        row.quantity_sold += quantity;
        row.revenue += allocatedLineRevenue(bill, item);
        row.cogs += quantity * toNumber(product?.costPrice, 0);
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
      const tax = billTax(bill);
      const revenue = billRevenue(bill);
      row.bills += 1;
      row.sales += revenue;
      row.tax += tax;
      row.net += Math.max(0, revenue - tax);
      row.refunds += billRefundAmount(bill);
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
      const hour = new Date(bill.created_at).getHours();
      rows[hour].bills += 1;
      rows[hour].sales += billRevenue(bill);
      rows[hour].tax += billTax(bill);
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
      row.sales += billRevenue(bill);
      row.discounts += toNumber(bill.discount_amount, 0);
      row.refunds += billRefundAmount(bill);
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
      const outletId = bill.outlet_id || "unassigned";
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
      row.sales += billRevenue(bill);
      row.tax += billTax(bill);
      row.refunds += billRefundAmount(bill);
      row.average_bill = row.bills ? row.sales / row.bills : 0;
      rowsById.set(outletId, row);
    });

    return { business_id: business.id, rows: Array.from(rowsById.values()).sort((a, b) => b.sales - a.sales) };
  }

  async customerAnalytics(input) {
    const { business, bills, feedback } = await this.getReportContext(input);
    const rowsByCustomer = new Map();
    bills.filter(isRevenueBill).forEach((bill) => {
      const key = bill.customer_phone || String(bill.customer_name || bill.customerName || "Walk-in").toLowerCase();
      const row = rowsByCustomer.get(key) || {
        customer_key: key,
        customer_name: bill.customer_name || bill.customerName || "Walk-in",
        customer_phone: bill.customer_phone || null,
        visits: 0,
        total_spent: 0,
        average_spend: 0,
        last_visit: null,
        preferred_channel: bill.order_type || "Dine-In",
        feedback_count: 0,
        average_rating: 0,
      };
      row.visits += 1;
      row.total_spent += billRevenue(bill);
      row.average_spend = row.total_spent / row.visits;
      row.last_visit = !row.last_visit || bill.created_at > row.last_visit ? bill.created_at : row.last_visit;
      rowsByCustomer.set(key, row);
    });

    feedback.forEach((item) => {
      const key = item.customerName ? String(item.customerName).toLowerCase() : null;
      if (!key || !rowsByCustomer.has(key)) return;
      const row = rowsByCustomer.get(key);
      row.feedback_count += 1;
      row.average_rating =
        (row.average_rating * (row.feedback_count - 1) + toNumber(item.rating, 0)) / row.feedback_count;
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
    const [sales, gst, profitability, hourly, staff, outlets, customers] = await Promise.all([
      this.salesByDate(input),
      this.gstTaxReport(input),
      this.productProfitability(input),
      this.hourlySales(input),
      this.staffPerformance(input),
      this.outletComparison(input),
      this.customerAnalytics(input),
    ]);

    return { sales, gst, profitability, hourly, staff, outlets, customers };
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
        content: `<html><body><h1>${key} report</h1><pre>${JSON.stringify(report, null, 2)}</pre></body></html>`,
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

  async writeSchedules(items) {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SCHEDULE_FILE, JSON.stringify(items, null, 2));
  }

  async listSchedules({ businessId }) {
    return (await this.readSchedules()).filter((item) => item.business_id === businessId);
  }

  async createSchedule({ businessId, payload, user }) {
    const schedules = await this.readSchedules();
    const item = {
      id: `sch_${Date.now()}`,
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
    schedules.unshift(item);
    await this.writeSchedules(schedules);
    return item;
  }

  async runSchedule({ tenantId, businessId, scheduleId }) {
    const schedules = await this.readSchedules();
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
    await this.writeSchedules(schedules);
    return { schedule, export: exportPayload };
  }
}

export const reportsService = new ReportsService();
