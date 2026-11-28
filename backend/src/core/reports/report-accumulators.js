import {
  getAllocatedLineRevenue,
  getBillChannel,
  getBillLineCost,
  getBillOutletId,
  getBillRefundAmount,
  getBillRevenue,
  getBillSubtotal,
  getBillTax,
  isRevenueBill,
  toAnalyticsNumber,
} from "../billing/bill-analytics.utils.js";
import { localDate, localHour } from "../../shared/utils/business-time.js";
import { reportCustomerKey } from "./customer-insights.js";

// Each report is a running tally: add(bill) for every bill in the period (any order), then result().
// The figures are the same calculations the reports always used; only the bills are no longer all held at once.

const WALK_IN = "walk-in";
const isWalkIn = (key) => key.startsWith("anonymous:");
const sumRows = (rows, fields) => rows.reduce((sum, row) => { for (const field of fields) sum[field] += row[field]; return sum; }, Object.fromEntries(fields.map((field) => [field, 0])));

export function salesTally(timezone) {
  const rowsByDate = new Map();
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const date = localDate(bill.created_at, timezone);
      const row = rowsByDate.get(date) || { date, bills: 0, sales: 0, tax: 0, net: 0, refunds: 0 };
      const tax = getBillTax(bill), revenue = getBillRevenue(bill);
      row.bills += 1; row.sales += revenue; row.tax += tax; row.net += Math.max(0, revenue - tax); row.refunds += getBillRefundAmount(bill);
      rowsByDate.set(date, row);
    },
    result() {
      const rows = [...rowsByDate.values()].sort((a, b) => b.date.localeCompare(a.date));
      return { summary: sumRows(rows, ["bills", "sales", "tax", "net", "refunds"]), rows };
    },
  };
}

export function gstTally(timezone, { keepRows = true } = {}) {
  const rows = [];
  const summary = { taxable_value: 0, cgst: 0, sgst: 0, igst: 0, tax_total: 0, invoice_total: 0 };
  let invoices = 0;
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const gst = bill.gst_breakup || {};
      const taxTotal = getBillTax(bill);
      const splitTotal = toAnalyticsNumber(gst.cgst) + toAnalyticsNumber(gst.sgst) + toAnalyticsNumber(gst.igst);
      const row = {
        invoice_number: bill.invoice_number || bill.id,
        date: localDate(bill.created_at, timezone),
        customer_name: bill.customer_name || bill.customerName || "Walk-in",
        taxable_value: getBillSubtotal(bill),
        cgst: splitTotal > 0 ? taxTotal * toAnalyticsNumber(gst.cgst) / splitTotal : taxTotal / 2,
        sgst: splitTotal > 0 ? taxTotal * toAnalyticsNumber(gst.sgst) / splitTotal : taxTotal / 2,
        igst: splitTotal > 0 ? taxTotal * toAnalyticsNumber(gst.igst) / splitTotal : 0,
        tax_total: taxTotal,
        invoice_total: getBillRevenue(bill),
        status: bill.status,
        created_at: bill.created_at,
      };
      for (const field of Object.keys(summary)) summary[field] += row[field];
      invoices += 1;
      if (keepRows) rows.push(row);
    },
    result() {
      // Newest first, as the report always listed invoices.
      const sorted = rows.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(({ created_at, ...row }) => row);
      return { summary, invoice_count: invoices, rows: sorted, ...(keepRows ? {} : { rows_note: "Invoice rows are in the GST export." }) };
    },
  };
}

export function profitabilityTally(products) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const rowsByKey = new Map();
  return {
    add(bill) {
      const revenueBill = isRevenueBill(bill);
      for (const item of bill.items || []) {
        const product = productById.get(item.productId);
        const key = item.productId || item.name;
        const row = rowsByKey.get(key) || { product_id: item.productId || null, name: item.name, category: product?.category || "Unmapped", quantity_sold: 0, revenue: 0, cogs: 0, estimated_cost: false, cost_missing: false, gross_profit: 0, margin_percent: 0 };
        row.quantity_sold += toAnalyticsNumber(item.quantity, 0);
        row.revenue += revenueBill ? getAllocatedLineRevenue(bill, item) : 0;
        const cost = getBillLineCost(bill, item, product);
        row.cogs += cost.amount;
        row.estimated_cost ||= cost.estimated;
        row.cost_missing ||= cost.missing && revenueBill;
        row.gross_profit = row.revenue - row.cogs;
        row.margin_percent = row.revenue > 0 ? (row.gross_profit / row.revenue) * 100 : 0;
        rowsByKey.set(key, row);
      }
    },
    result() {
      const rows = [...rowsByKey.values()].sort((left, right) => right.gross_profit - left.gross_profit);
      return { summary: { ...sumRows(rows, ["quantity_sold", "revenue", "cogs", "gross_profit"]), items_without_cost: rows.filter((row) => row.cost_missing).length }, rows };
    },
  };
}

/** Profit for revenue bills (GST excluded, cost recorded at sale), as the dashboard shows it. */
export function profitSummaryTally(products, { keepBills = false } = {}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const bills = new Map(), missing = new Set();
  let netSales = 0, goodsCost = 0;
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      let cost = 0;
      for (const item of bill.items || []) {
        const line = getBillLineCost(bill, item, productById.get(item.productId));
        cost += line.amount;
        if (line.missing) missing.add(item.productId || item.name);
      }
      const net = getBillSubtotal(bill);
      netSales += net; goodsCost += cost;
      if (keepBills) bills.set(bill.id, { net_sales: net, goods_cost: cost, gross_profit: net - cost });
    },
    result() {
      const grossProfit = netSales - goodsCost;
      return { net_sales: netSales, goods_cost: goodsCost, gross_profit: grossProfit, margin_percent: netSales ? (grossProfit / netSales) * 100 : 0, items_without_cost: missing.size, bills };
    },
  };
}

export function hourlyTally(timezone) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${String(hour).padStart(2, "0")}:00`, bills: 0, sales: 0, tax: 0, average_bill: 0 }));
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const row = rows[localHour(bill.created_at, timezone)];
      row.bills += 1; row.sales += getBillRevenue(bill); row.tax += getBillTax(bill);
      row.average_bill = row.sales / row.bills;
    },
    result: () => ({ rows }),
  };
}

export function staffTally(users) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const rowsById = new Map();
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const staffId = bill.created_by || "unknown", user = usersById.get(staffId);
      const row = rowsById.get(staffId) || { staff_id: staffId, name: bill.created_by_name || user?.name || "Unknown", role: bill.created_by_role || user?.role?.name || "Unknown", bills: 0, sales: 0, discounts: 0, refunds: 0, voids: 0, average_bill: 0 };
      row.bills += 1; row.sales += getBillRevenue(bill); row.discounts += toAnalyticsNumber(bill.discount_amount, 0); row.refunds += getBillRefundAmount(bill);
      row.average_bill = row.sales / row.bills;
      rowsById.set(staffId, row);
    },
    result: () => ({ rows: [...rowsById.values()].sort((a, b) => b.sales - a.sales) }),
  };
}

export function outletTally(outlets) {
  const outletsById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const rowsById = new Map();
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const outletId = getBillOutletId(bill) || "unassigned", outlet = outletsById.get(outletId);
      const row = rowsById.get(outletId) || { outlet_id: outletId, outlet_name: outlet?.name || "Unassigned", bills: 0, sales: 0, tax: 0, refunds: 0, average_bill: 0 };
      row.bills += 1; row.sales += getBillRevenue(bill); row.tax += getBillTax(bill); row.refunds += getBillRefundAmount(bill);
      row.average_bill = row.sales / row.bills;
      rowsById.set(outletId, row);
    },
    result: () => ({ rows: [...rowsById.values()].sort((a, b) => b.sales - a.sales) }),
  };
}

/**
 * Guests by phone. Bills without a phone are walk-ins: they are counted (visits and spend) in one "Walk-in guests"
 * row instead of one row per bill. feedbackByBill: billId -> [ratings] for the period.
 */
export function customerTally(feedbackByBill = new Map()) {
  const rows = new Map();
  let walkInVisits = 0;
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const phoneKey = reportCustomerKey(bill), anonymous = isWalkIn(phoneKey), key = anonymous ? WALK_IN : phoneKey;
      const row = rows.get(key) || { customer_key: key, customer_name: anonymous ? "Walk-in guests (no phone)" : bill.customer_name || bill.customerName || "Walk-in", customer_phone: anonymous ? null : bill.customer_phone || null, anonymous,
        visits: 0, total_spent: 0, average_spend: 0, last_visit: null, preferred_channel: getBillChannel(bill) === "online" ? "Online" : "Dine-In", feedback_count: 0, average_rating: null, rated_feedback: 0 };
      row.visits += 1; row.total_spent += getBillRevenue(bill); row.average_spend = row.total_spent / row.visits;
      row.last_visit = !row.last_visit || bill.created_at > row.last_visit ? bill.created_at : row.last_visit;
      if (anonymous) walkInVisits += 1;
      for (const rating of feedbackByBill.get(bill.id) || []) {
        row.feedback_count += 1;
        if (Number.isInteger(rating) && rating >= 1 && rating <= 5) { row.average_rating = ((row.average_rating || 0) * row.rated_feedback + rating) / (row.rated_feedback + 1); row.rated_feedback += 1; }
      }
      rows.set(key, row);
    },
    result() {
      const list = [...rows.values()].sort((a, b) => b.total_spent - a.total_spent);
      const known = list.filter((row) => !row.anonymous);
      const spend = list.reduce((sum, row) => sum + row.total_spent, 0);
      // A walk-in is a guest per visit, as before; repeat guests can only be recognised by phone.
      const guests = known.length + walkInVisits;
      return { summary: { total_customers: guests, known_customers: known.length, walk_in_visits: walkInVisits, repeat_customers: known.filter((row) => row.visits > 1).length, total_spend: spend, average_customer_value: guests ? spend / guests : 0 }, rows: list };
    },
  };
}

/** Customer insights (favourites, item sales by channel, loyalty). Same rules as customer-insights.js, folded per bill. */
export function customerInsightsTally(profiles = [], ratings = []) {
  const customers = new Map(), items = new Map();
  const points = new Map(profiles.map((row) => [row.phone, row.loyaltyPoints]));
  let walkInVisits = 0;
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const phoneKey = reportCustomerKey(bill), anonymous = isWalkIn(phoneKey), key = anonymous ? WALK_IN : phoneKey, channel = getBillChannel(bill);
      if (anonymous) walkInVisits += 1;
      const guest = customers.get(key) || { customer_key: key, customer_name: anonymous ? "Walk-in guests (no phone)" : bill.customer_name || "Walk-in", customer_phone: anonymous ? "" : bill.customer_phone || "", anonymous, visits: 0, total_spent: 0, loyalty_points: anonymous ? 0 : points.get(key) || 0, preferred_channel: channel === "online" ? "Online" : "Dine-In", favorites: new Map() };
      guest.visits += 1; guest.total_spent += getBillRevenue(bill);
      for (const line of bill.items || []) {
        const qty = Number(line.quantity), revenue = getAllocatedLineRevenue(bill, line), itemKey = line.productId || line.product_id || line.name;
        guest.favorites.set(line.name, (guest.favorites.get(line.name) || 0) + qty);
        const item = items.get(itemKey) || { item_name: line.name, category: "—", inhouse_qty: 0, inhouse_revenue: 0, online_qty: 0, online_revenue: 0, total_qty: 0, total_revenue: 0 };
        const prefix = channel === "online" ? "online" : "inhouse";
        item[`${prefix}_qty`] += qty; item[`${prefix}_revenue`] += revenue; item.total_qty += qty; item.total_revenue += revenue;
        items.set(itemKey, item);
      }
      customers.set(key, guest);
    },
    result() {
      const rows = [...customers.values()].map(({ favorites, ...row }) => ({ ...row, favorite_item: [...favorites].sort((a, b) => b[1] - a[1])[0]?.[0] || "—", favorite_category: "—", segment: row.anonymous ? "Walk-in" : row.visits >= 5 ? "VIP" : row.visits >= 2 ? "Regular" : "New" }));
      const known = rows.filter((row) => !row.anonymous), spend = rows.reduce((sum, row) => sum + row.total_spent, 0), guests = known.length + walkInVisits;
      const rated = ratings.filter((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5);
      return {
        summary: { total_customers: guests, repeat_customers: known.filter((row) => row.visits > 1).length, loyalty_points_held: known.reduce((sum, row) => sum + row.loyalty_points, 0), average_customer_value: guests ? spend / guests : 0, average_feedback: rated.length ? rated.reduce((sum, rating) => sum + rating, 0) / rated.length : null },
        customers: rows,
        item_sales_by_channel: [...items.values()],
        campaign_suggestions: known.filter((row) => row.customer_phone).map((row) => ({ ...row, offer: `Review consent before offering a return visit promotion for ${row.favorite_item}` })),
      };
    },
  };
}

/** Bills per product id (a bill counts once per product it contains; lines without an id match by name). */
export function productInvoiceTally(products = []) {
  const idByName = new Map(products.map((product) => [product.name, product.id]));
  const counts = new Map();
  return {
    add(bill) {
      if (!isRevenueBill(bill)) return;
      const ids = new Set();
      for (const line of bill.items || []) { const id = line.product_id || line.productId || idByName.get(line.name); if (id) ids.add(id); }
      for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    },
    result: () => counts,
  };
}

/**
 * Merges saved per-day, per-outlet report figures (each produced by the tallies above for that day's bills) into
 * the report for a range. days: [{ day, outlet, sales, hourly, profitability, staff, gst }].
 */
export function mergeReportDays(days, outlets = []) {
  const outletNames = new Map(outlets.map((outlet) => [outlet.id, outlet.name]));
  const byDate = new Map(), products = new Map(), staff = new Map(), byOutlet = new Map();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${String(hour).padStart(2, "0")}:00`, bills: 0, sales: 0, tax: 0, average_bill: 0 }));
  const gst = { taxable_value: 0, cgst: 0, sgst: 0, igst: 0, tax_total: 0, invoice_total: 0 };
  let invoices = 0;
  for (const entry of days) {
    const s = entry.sales;
    if (s.bills) {
      const row = byDate.get(entry.day) || { date: entry.day, bills: 0, sales: 0, tax: 0, net: 0, refunds: 0 };
      for (const field of ["bills", "sales", "tax", "net", "refunds"]) row[field] += s[field];
      byDate.set(entry.day, row);
      const outletId = entry.outlet || "unassigned";
      const outletRow = byOutlet.get(outletId) || { outlet_id: outletId, outlet_name: outletNames.get(outletId) || "Unassigned", bills: 0, sales: 0, tax: 0, refunds: 0, average_bill: 0 };
      for (const field of ["bills", "sales", "tax", "refunds"]) outletRow[field] += s[field];
      byOutlet.set(outletId, outletRow);
    }
    entry.hourly.forEach((row, hour) => { hourly[hour].bills += row.bills; hourly[hour].sales += row.sales; hourly[hour].tax += row.tax; });
    for (const row of entry.profitability) {
      const key = row.product_id || row.name;
      const merged = products.get(key) || { ...row, quantity_sold: 0, revenue: 0, cogs: 0, estimated_cost: false, cost_missing: false };
      merged.quantity_sold += row.quantity_sold; merged.revenue += row.revenue; merged.cogs += row.cogs;
      merged.estimated_cost ||= row.estimated_cost; merged.cost_missing ||= row.cost_missing;
      products.set(key, merged);
    }
    for (const row of entry.staff) {
      const merged = staff.get(row.staff_id) || { ...row, bills: 0, sales: 0, discounts: 0, refunds: 0, voids: 0 };
      for (const field of ["bills", "sales", "discounts", "refunds", "voids"]) merged[field] += row[field];
      staff.set(row.staff_id, merged);
    }
    for (const field of Object.keys(gst)) gst[field] += entry.gst.summary[field];
    invoices += entry.gst.invoice_count;
  }
  for (const row of hourly) row.average_bill = row.bills ? row.sales / row.bills : 0;
  const productRows = [...products.values()].map((row) => ({ ...row, gross_profit: row.revenue - row.cogs, margin_percent: row.revenue > 0 ? ((row.revenue - row.cogs) / row.revenue) * 100 : 0 })).sort((a, b) => b.gross_profit - a.gross_profit);
  const salesRows = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  return {
    sales: { summary: sumRows(salesRows, ["bills", "sales", "tax", "net", "refunds"]), rows: salesRows },
    hourly: { rows: hourly },
    profitability: { summary: { ...sumRows(productRows, ["quantity_sold", "revenue", "cogs", "gross_profit"]), items_without_cost: productRows.filter((row) => row.cost_missing).length }, rows: productRows },
    staff: { rows: [...staff.values()].map((row) => ({ ...row, average_bill: row.bills ? row.sales / row.bills : 0 })).sort((a, b) => b.sales - a.sales) },
    outlets: { rows: [...byOutlet.values()].map((row) => ({ ...row, average_bill: row.bills ? row.sales / row.bills : 0 })).sort((a, b) => b.sales - a.sales) },
    gst: { summary: gst, invoice_count: invoices, rows: [], rows_note: "Invoice rows are in the GST export." },
  };
}
