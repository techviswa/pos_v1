import { getAllocatedLineRevenue, getBillChannel, getBillRevenue, isRevenueBill } from "../billing/bill-analytics.utils.js";
import { normalizePhone } from "../customers/customer-core.js";

// Phone identifies a known guest; anonymous bills remain separate visits.
export const reportCustomerKey = (bill) => normalizePhone(bill.customer_phone) || `anonymous:${bill.id}`;
export function customerInsights(bills, profiles = [], feedback = []) {
  const customers = new Map(), items = new Map();
  const points = new Map(profiles.map((row) => [row.phone, row.loyaltyPoints]));
  for (const bill of bills.filter(isRevenueBill)) {
    const key = reportCustomerKey(bill);
    const guest = customers.get(key) || { customer_key: key, customer_name: bill.customer_name || "Walk-in", customer_phone: bill.customer_phone || "", visits: 0, total_spent: 0, loyalty_points: points.get(key) || 0, preferred_channel: getBillChannel(bill) === "online" ? "Online" : "Dine-In", favorites: new Map() };
    guest.visits++; guest.total_spent += getBillRevenue(bill);
    for (const line of bill.items || []) {
      const qty = Number(line.quantity), revenue = getAllocatedLineRevenue(bill, line), itemKey = line.productId || line.product_id || line.name;
      guest.favorites.set(line.name, (guest.favorites.get(line.name) || 0) + qty);
      const item = items.get(itemKey) || { item_name: line.name, category: "—", inhouse_qty: 0, inhouse_revenue: 0, online_qty: 0, online_revenue: 0, total_qty: 0, total_revenue: 0 };
      const prefix = getBillChannel(bill) === "online" ? "online" : "inhouse";
      item[`${prefix}_qty`] += qty; item[`${prefix}_revenue`] += revenue;
      item.total_qty += qty; item.total_revenue += revenue; items.set(itemKey, item);
    }
    customers.set(key, guest);
  }
  const rows = [...customers.values()].map(({ favorites, ...row }) => ({ ...row, favorite_item: [...favorites].sort((a, b) => b[1] - a[1])[0]?.[0] || "—", favorite_category: "—", segment: row.visits >= 5 ? "VIP" : row.visits >= 2 ? "Regular" : "New" }));
  const rated = feedback.filter((row) => Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5);
  return { summary: { total_customers: rows.length, repeat_customers: rows.filter((row) => row.visits > 1).length, loyalty_points_held: rows.reduce((sum, row) => sum + row.loyalty_points, 0), average_customer_value: rows.length ? rows.reduce((sum, row) => sum + row.total_spent, 0) / rows.length : 0, average_feedback: rated.length ? rated.reduce((sum, row) => sum + row.rating, 0) / rated.length : null }, customers: rows, item_sales_by_channel: [...items.values()], campaign_suggestions: rows.filter((row) => row.customer_phone).map((row) => ({ ...row, offer: `Review consent before offering a return visit promotion for ${row.favorite_item}` })) };
}
