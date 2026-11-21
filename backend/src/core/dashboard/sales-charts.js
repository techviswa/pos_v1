import { getBillRevenue, isRevenueBill } from "../billing/bill-analytics.utils.js";

// Use the report calendar (UTC) and include quiet days, rather than joining gaps.
export const buildSalesCharts = (bills, now = new Date()) => {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const rows = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - 29 + index);
    return { date: day.toISOString().slice(0, 10), sales: 0, bills: 0 };
  });
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const modes = new Map();
  for (const bill of bills) {
    if (!isRevenueBill(bill)) continue;
    const created = new Date(bill.created_at || bill.createdAt);
    if (!Number.isFinite(created.getTime()) || created > now) continue;
    const row = byDate.get(created.toISOString().slice(0, 10));
    if (!row) continue;
    const sales = getBillRevenue(bill);
    row.sales += sales;
    row.bills += 1;
    const raw = String(bill.service_mode || bill.order_type || "").toUpperCase();
    const name = /DELIVERY/.test(raw) ? "Delivery" : /PICKUP/.test(raw) ? "Pickup" : /TOKEN|TAKEAWAY/.test(raw) ? "Token / takeaway" : /TABLE|DINE/.test(raw) ? "Table" : "Other / unspecified";
    modes.set(name, (modes.get(name) || 0) + sales);
  }
  return { rows, modes: Array.from(modes, ([name, sales]) => ({ name, sales })), from: rows[0].date, to: rows[29].date, timezone: "UTC" };
};
