// Dashboard profit must equal Reports profit: GST is not income, and a bill keeps the cost recorded when it was sold.
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "../src/config/db.js";
import prisma from "../src/database/prisma/client.js";
import { usersService } from "../src/core/users/users.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { reportsService } from "../src/core/reports/reports.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const { default: app } = await import("../src/app.js");
const id = `dash-profit-${randomUUID().slice(0, 8)}`, tenantId = `tenant-${id}`, password = `Pw-${randomUUID()}`;
const server = http.createServer(app);
try {
  await connectDatabase();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await prisma.business.create({ data: { id, tenantId, name: "Dashboard profit fixture" } });
  const outlet = await prisma.outlet.create({ data: { businessId: id, name: "Main", code: `M${id.slice(-6)}` } });
  const owner = await usersService.createUser({ businessId: id, tenantId, payload: { email: `o-${id}@t.test`, password, role: "Owner", name: "Owner", profile_required: false } });
  const costed = await prisma.product.create({ data: { businessId: id, name: "Costed", category: "Food", price: 100, costPrice: 30, stock: 50 } });
  const uncosted = await prisma.product.create({ data: { businessId: id, name: "No cost yet", category: "Food", price: 50, stock: 50 } });
  await billingService.createInvoice({ tenantId, user: owner, payload: { outlet_id: outlet.id, gst_rate: 18, payment_type: "Cash", items: [
    { productId: costed.id, name: costed.name, quantity: 2, price: 100 }, { productId: uncosted.id, name: uncosted.name, quantity: 1, price: 50 }] } });
  // A later cost change must not rewrite the profit of a sale already made.
  await prisma.product.update({ where: { id: costed.id }, data: { costPrice: 1000 } });

  const report = await reportsService.productProfitability({ tenantId });
  assert.equal(report.summary.revenue, 250);
  assert.equal(report.summary.cogs, 60);
  assert.equal(report.summary.items_without_cost, 1);
  assert.equal(report.rows.find((row) => row.product_id === uncosted.id).cost_missing, true);

  const login = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: owner.email, password }) });
  const session = (await login.json()).data.session_id;
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard/stats`, { headers: { "x-cf-session-id": session } });
  assert.equal(response.status, 200);
  const body = await response.json();
  const stats = body.data ?? body;
  assert.equal(stats.total_revenue, 295, "sales shown to the owner include GST");
  assert.equal(stats.revenue_summary.net_sales, 250, "profit is measured on sales excluding GST");
  assert.equal(stats.revenue_summary.goods_cost, report.summary.cogs, "dashboard cost equals the report's recorded cost");
  assert.equal(stats.revenue_summary.gross_profit, report.summary.gross_profit);
  assert.equal(stats.revenue_summary.items_without_cost, 1);
  assert.equal(Math.round(stats.revenue_summary.margin_percent * 10) / 10, 76);
  const bill = stats.revenue_detail.bills[0];
  assert.deepEqual([bill.revenue, bill.net_sales, bill.goods_cost, bill.gross_profit], [295, 250, 60, 190]);
  console.log("Dashboard profit passed: matches Reports, excludes GST, keeps recorded cost after a price change, flags items sold without a cost.");
} finally {
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
