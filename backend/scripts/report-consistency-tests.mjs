import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { reportsService } from "../src/core/reports/reports.service.js";
import { feedbackService } from "../src/core/feedback/feedback.service.js";
import { runTenantScope } from "../src/database/prisma/tenant-context.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";
import { billingService } from "../src/core/billing/billing.service.js";

const suffix = randomUUID(), businessId = `report-${suffix}`, tenantId = `tenant-${suffix}`;
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
try {
  await connectDatabase();
  await prisma.business.create({ data: { id: businessId, tenantId, name: "Isolated reporting fixture" } });
  const outlet = await prisma.outlet.create({ data: { businessId, name: "One", code: "ONE" } });
  const other = await prisma.outlet.create({ data: { businessId, name: "Two", code: "TWO" } });
  const ingredient = await prisma.inventoryItem.create({ data: { businessId, name: "Flour", stock: 5, unit: "kg", conversionCost: 100 } });
  const product = await prisma.product.create({ data: { businessId, name: "Bread", category: "Bakery", price: 10, recipeLines: [{ inventory_id: ingredient.id, quantity: 100, unit: "g" }] } });
  await prisma.outletProduct.create({ data: { outletId: outlet.id, productId: product.id } });
  await prisma.customer.create({ data: { businessId, phone: "9876543210", name: "Same name", loyaltyPoints: 7 } });
  const billIds = Array.from({ length: 302 }, (_, index) => `report-bill-${suffix}-${index}`);
  await prisma.bill.createMany({ data: billIds.map((id, index) => ({ id, businessId, customerName: "Same name", currency: "INR", subtotal: 10, total: 10, status: "paid", metadata: { outlet_id: index === 301 ? other.id : outlet.id, customer_phone: index === 0 ? "9876543210" : `9000${String(index).padStart(6, "0")}` }, createdAt: new Date(index === 300 ? "2026-09-01T12:00:00Z" : "2026-10-01T12:00:00Z") })) });
  await prisma.billItem.createMany({ data: billIds.map((billId) => ({ billId, productId: product.id, name: "Bread", quantity: 1, price: 10 })) });
  await prisma.feedback.createMany({ data: Array.from({ length: 503 }, (_, index) => ({ businessId, billId: billIds[index === 501 ? 301 : 0], customerName: "Different feedback name", rating: index === 0 ? 5 : index === 1 ? 3 : index === 501 ? 1 : null, createdAt: new Date(index === 502 ? "2026-09-01T00:00:00Z" : "2026-10-01T13:00:00Z") })) });
  const input = { tenantId, outletId: outlet.id, from: "2026-10-01", to: "2026-10-01" };
  await runTenantScope({ businessId, tenantId }, async () => {
    const report = await reportsService.getDashboard(input);
    eq(report.sales.summary.bills, 300); eq(report.sales.summary.sales, 3000);
    eq(report.profitability.summary.quantity_sold, 300);
    const first = await billingService.listInvoices({ tenantId, outletIds: [outlet.id], from: input.from, to: input.to, limit: 250, page: 1 });
    const second = await billingService.listInvoices({ tenantId, outletIds: [outlet.id], from: input.from, to: input.to, limit: 250, page: 2 });
    eq(first.length, 250); eq(second.length, 50); eq(new Set([...first, ...second].map((row) => row.id)).size, 300);
    eq(report.customers.summary.total_customers, 300);
    eq(report.customer_insights.summary.total_customers, 300);
    eq(report.customer_insights.summary.loyalty_points_held, 7);
    eq(report.feedback.items.length, 501); eq(report.feedback.summary.average_rating, 4); eq(report.feedback.summary.rated_feedback, 2);
    const guest = report.customers.rows.find((row) => row.customer_phone === "9876543210");
    eq(guest.average_rating, 4); eq(guest.feedback_count, 501);
    eq(report.recipes.recipe_product_count, 1);
    eq(report.recipes.products[0].base_recipe_cost, null); // No outlet balance: unknown, not zero/blocked.
    eq(report.recipes.blocked_product_count, 0);
    const global = await reportsService.getDashboard({ tenantId, from: input.from, to: input.to });
    eq(global.recipes.products[0].base_recipe_cost, 10); // 100g at 100/kg.
    const listed = await feedbackService.listFeedback({ businessId, outletIds: [outlet.id], from: input.from, to: input.to });
    eq(listed.summary.total_feedback, 501); eq(listed.summary.average_rating, 4);
    const exported = await reportsService.exportReport({ ...input, key: "sales", format: "json" });
    eq(JSON.parse(exported.content).summary.sales, report.sales.summary.sales);
    await assert.rejects(reportsService.getDashboard({ ...input, from: "2026-02-30" })); checks++;
  });
  console.log(`Report consistency passed: ${checks} checks for >250 invoices, >500 feedback records, scoped dates/outlets, customer identity, real loyalty, unit conversion, unknown stock and matching exports.`);
} finally {
  await prisma.feedback.deleteMany({ where: { businessId } });
  await prisma.bill.deleteMany({ where: { businessId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await stopRealtime(); await prisma.$disconnect();
}
