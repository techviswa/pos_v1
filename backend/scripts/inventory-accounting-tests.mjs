import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { inventoryOperationsService as operations } from "../src/core/inventory/inventory-operations.service.js";
import { inventoryService } from "../src/core/inventory/inventory.service.js";
import { returnPurchase, stockValuation } from "../src/core/inventory/inventory-accounting.service.js";
import { reportsService } from "../src/core/reports/reports.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { reverseBillStock } from "../src/core/billing/stock-reversal.service.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";

export async function testInventoryAccounting({ tenantId, businessId, user, apiUrl, sessionId, restrictedSessionId }) {
  const outlet = await prisma.outlet.create({ data: { businessId, name: "Valuation test outlet", code: randomUUID() } });
  const ingredient = await inventoryService.createItem({ tenantId, payload: { name: "Valuation test flour", stock: 0, unit: "kg", conversion_cost: 0 } });
  const receive = (quantity, unit_cost, stock_location, request_id) => operations.receivePurchase({ tenantId, user, payload: {
    outlet_id: outlet.id, stock_location, request_id, vendor_name: "Fixture supplier", items: [{ inventory_id: ingredient.id, quantity, unit_cost }] } });
  const receiptKey = randomUUID();
  const [originalReceipt, receiptReplay] = await Promise.all([receive(10, 100, "central", receiptKey), receive(10, 100, "central", receiptKey)]);
  assert.equal(originalReceipt.record.id, receiptReplay.record.id, "Receiving replay must not duplicate stock");
  await assert.rejects(receive(11, 100, "central", receiptKey), /different data/);
  await receive(10, 200);
  assert.equal((await prisma.inventoryItem.findUnique({ where: { id: ingredient.id } })).conversionCost, 150);
  const transfer = await operations.createTransferRequest({ tenantId, user, payload: { destination_outlet_id: outlet.id, items: [{ inventory_id: ingredient.id, quantity: 4 }] } });
  await operations.approveTransfer({ tenantId, user, allocationId: transfer.id });
  const transit = (await stockValuation({ tenantId })).in_transit.find((row) => row.transfer_id === transfer.id);
  assert.equal(transit.value, 600);
  await operations.receiveTransfer({ tenantId, user, allocationId: transfer.id });
  await receive(4, 50, "outlet");
  const balance = () => prisma.outletInventory.findUnique({ where: { outletId_inventoryItemId: { outletId: outlet.id, inventoryItemId: ingredient.id } } });
  assert.equal((await balance()).stock, 8);
  assert.equal((await balance()).unitCost, 100);
  const request = { tenantId, user, receiptId: originalReceipt.record.id, payload: { request_id: randomUUID(), reason: "Return excess flour",
    items: [{ movement_id: originalReceipt.received_items[0].movement_id, quantity: 2 }] } };
  const results = await Promise.all([returnPurchase(request), returnPurchase(request)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].credit_amount, 200);
  assert.equal(results[0].stock_value_removed, 300);
  assert.equal(results[0].purchase_price_variance, -100);
  assert.equal((await prisma.inventoryItem.findUnique({ where: { id: ingredient.id } })).stock, 14);
  await assert.rejects(returnPurchase({ ...request, payload: { ...request.payload, reason: "Changed request" } }), /different return/);
  await assert.rejects(returnPurchase({ ...request, tenantId: "foreign-accounting-tenant" }), (error) => error.statusCode === 404);
  const foreign = await prisma.business.create({ data: { name: "Foreign scope fixture", tenantId: randomUUID() } });
  try {
    await assert.rejects(returnPurchase({ ...request, tenantId: foreign.tenantId }), /not found in this business/);
    assert.equal((await stockValuation({ tenantId: foreign.tenantId })).rows.length, 0);
  } finally { await prisma.business.delete({ where: { id: foreign.id } }); }
  await assert.rejects(returnPurchase({ ...request, user: { ...user, role: "Cashier" } }), /Manager/);
  const excess = { ...request, payload: { ...request.payload, request_id: randomUUID(), items: [{ ...request.payload.items[0], quantity: 9 }] } };
  await assert.rejects(returnPurchase(excess), /exceeds/);
  const originalNotify = admincoreChangeSyncService.notifyChange;
  try {
    admincoreChangeSyncService.notifyChange = async () => { throw new Error("Injected accounting outbox failure"); };
    await assert.rejects(returnPurchase({ ...request, payload: { ...request.payload, request_id: randomUUID() } }), /outbox failure/);
  } finally { admincoreChangeSyncService.notifyChange = originalNotify; }
  assert.equal((await prisma.inventoryItem.findUnique({ where: { id: ingredient.id } })).stock, 14);
  await inventoryService.updateItem({ tenantId, itemId: ingredient.id, payload: { conversion_cost: 900 } });
  assert.equal((await balance()).unitCost, 100, "Outlet valuation is independent of later central revaluation");
  const product = await prisma.product.create({ data: { businessId, name: "Valuation recipe test", category: "Fixture", price: 300, stock: 100000,
    recipeLines: [{ inventory_id: ingredient.id, quantity: 1, unit: "kg" }] } });
  const bill = await billingService.createInvoice({ tenantId, user, payload: { outlet_id: outlet.id,
    items: [{ productId: product.id, name: product.name, quantity: 2, price: 300 }], gst_rate: 0, payment_type: "Cash" } });
  const profit = async () => (await reportsService.productProfitability({ tenantId, outletId: outlet.id })).rows.find((row) => row.product_id === product.id);
  assert.equal((await profit()).cogs, 200);
  await billingService.refundInvoice({ tenantId, user, invoiceId: bill.id, payload: { amount: 300, reason: "One unprepared meal" } });
  const partial = { tenantId, user, invoiceId: bill.id, payload: { request_id: randomUUID(), unprepared: true, reason: "Unused meal ingredients",
    products: [{ product_id: product.id, quantity: 1 }] } };
  const restores = await Promise.all([reverseBillStock(partial), reverseBillStock(partial)]);
  assert.deepEqual(restores[0], restores[1]);
  assert.equal((await balance()).stock, 7);
  assert.equal((await profit()).cogs, 100);
  assert.equal((await profit()).revenue, 300);
  await assert.rejects(reverseBillStock({ ...partial, payload: { ...partial.payload, request_id: randomUUID(), products: [{ product_id: product.id, quantity: 2 }] } }), /remaining/);
  await billingService.refundInvoice({ tenantId, user, invoiceId: bill.id, payload: { amount: 300, reason: "Remaining meal refunded" } });
  assert.equal((await profit()).revenue, 0);
  assert.equal((await profit()).cogs, 100, "Refunding prepared food does not erase its cost");
  await reverseBillStock({ ...partial, payload: { unprepared: true, reason: "Remaining portion also unused" } });
  assert.equal((await balance()).stock, 8, "Full restoration subtracts portions already restored");
  assert.equal((await profit()).cogs, 0);
  const report = await reportsService.productProfitability({ tenantId, outletId: outlet.id });
  const inventoryReport = await operations.getCogsReport({ tenantId, outletId: outlet.id });
  assert.deepEqual(inventoryReport.rows, report.rows);
  for (const key of Object.keys(report.summary)) assert.equal(inventoryReport.totals[key], report.summary[key]);
  assert.equal((await operations.getCogsReport({ tenantId, from: "2000-01-01", to: "2000-01-02" })).rows.length, 0);
  const valuation = await stockValuation({ tenantId });
  assert.ok(valuation.rows.filter((row) => row.inventory_id === ingredient.id).every((row) => row.reconciliation === "matched"));
  await assert.rejects(inventoryService.deleteItem({ tenantId, itemId: ingredient.id }), /history/);
  const get = (path, token = sessionId) => fetch(`${apiUrl}${path}`, { headers: { "x-cf-session-id": token } });
  assert.equal((await get("/api/inventory/accounting/valuation")).status, 200);
  assert.equal((await get("/api/inventory/accounting/receipts")).status, 200);
  assert.equal((await get("/api/inventory/accounting/valuation", restrictedSessionId)).status, 403);
  assert.equal((await get("/api/inventory/reports/cogs", restrictedSessionId)).status, 403);
  const deniedReturn = await fetch(`${apiUrl}/api/inventory/accounting/receipts/${originalReceipt.record.id}/returns`, { method: "POST",
    headers: { "content-type": "application/json", "x-cf-session-id": restrictedSessionId }, body: JSON.stringify(request.payload) });
  assert.equal(deniedReturn.status, 403);
  const edit = await fetch(`${apiUrl}/api/inventory/${ingredient.id}`, { method: "PUT",
    headers: { "content-type": "application/json", "x-cf-session-id": sessionId }, body: JSON.stringify({ stock: 15 }) });
  assert.equal(edit.status, 200);
  assert.equal((await stockValuation({ tenantId })).rows.find((row) => row.inventory_id === ingredient.id && row.outlet_id === null).reconciliation, "matched");
  await prisma.inventoryItem.update({ where: { id: ingredient.id }, data: { stock: 16 } });
  assert.equal((await stockValuation({ tenantId })).rows.find((row) => row.inventory_id === ingredient.id && row.outlet_id === null).reconciliation, "difference");
  await inventoryService.updateItem({ tenantId, itemId: ingredient.id, payload: { stock: 17 } });
  assert.equal((await stockValuation({ tenantId })).rows.find((row) => row.inventory_id === ingredient.id && row.outlet_id === null).ledger_breaks, 1, "A later valid movement must not hide an earlier untracked change");
  console.log("Inventory accounting passed: weighted outlet cost, in-transit value, idempotent partial supplier/customer returns, outbox rollback, tenant/role denial, retained refund COGS, report parity and ledger reconciliation.");
}
