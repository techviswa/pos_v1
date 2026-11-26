// Closing an outlet: refused while money or stock is still in motion there; a closed outlet takes no bills,
// frees its plan slot, and reopening is checked against the plan.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { outletsService } from "../src/core/outlets/outlets.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { settlementService } from "../src/core/billing/settlement.service.js";
import { inventoryOperationsService as operations } from "../src/core/inventory/inventory-operations.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const id = `outlet-close-${randomUUID().slice(0, 8)}`, tenantId = `tenant-${id}`;
const owner = { id: "owner", role: "Owner", name: "Owner" };
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const refused = async (promise, pattern) => { await assert.rejects(promise, (error) => error.statusCode === 409 && pattern.test(error.message)); checks++; };
const close = (outletId) => outletsService.updateOutlet({ tenantId, outletId, payload: { status: "inactive" } });
try {
  await connectDatabase();
  await prisma.business.create({ data: { id, tenantId, name: "Outlet close fixture" } });
  await saasService.updateSubscription({ businessId: id, payload: { plan: "growth", subscription_status: "active" } });
  const a = await prisma.outlet.create({ data: { businessId: id, name: "Airport", code: `A${id.slice(-6)}`, status: "active" } });
  const b = await prisma.outlet.create({ data: { businessId: id, name: "Mall", code: `B${id.slice(-6)}`, status: "active" } });
  const product = await prisma.product.create({ data: { businessId: id, name: "Tea", category: "Drinks", price: 100, stock: 50 } });
  const flour = await prisma.inventoryItem.create({ data: { businessId: id, name: "Flour", unit: "kg", stock: 10 } });
  eq((await saasService.getUsage({ businessId: id })).limits.outlets.used, 2);

  // An unpaid bill and the open cash shift it starts both block closing.
  const due = await billingService.createInvoice({ tenantId, user: owner, payload: { outlet_id: a.id, payment_type: "Due", items: [{ productId: product.id, name: "Tea", quantity: 1, price: 100 }] } });
  await refused(close(a.id), /cash drawer shift is still open.*1 bill\(s\) still have money to collect/);
  await billingService.addPayment({ tenantId, invoiceId: due.id, user: owner, payload: { amount: due.total, method: "Cash" } });
  const shift = await settlementService.current({ businessId: id, outletId: a.id });
  await settlementService.close({ businessId: id, outletId: a.id, closingCash: due.total, shiftId: shift.id, user: owner });

  // A transfer on its way blocks closing until it is received.
  const transfer = await operations.createTransferRequest({ tenantId, user: owner, payload: { destination_outlet_id: a.id, items: [{ inventory_id: flour.id, quantity: 2 }] } });
  await refused(close(a.id), /1 stock transfer\(s\) are not finished/);
  await operations.approveTransfer({ tenantId, allocationId: transfer.id, user: owner });
  await refused(close(a.id), /stock transfer/);
  await operations.receiveTransfer({ tenantId, allocationId: transfer.id, user: owner });

  // Now it closes: history stays, the plan slot is freed, and no new bill can be taken there.
  eq((await close(a.id)).status, "inactive");
  eq((await saasService.getUsage({ businessId: id })).limits.outlets.used, 1, "a closed outlet frees its plan slot");
  await assert.rejects(billingService.createInvoice({ tenantId, user: owner, payload: { outlet_id: a.id, payment_type: "Cash", items: [{ productId: product.id, name: "Tea", quantity: 1, price: 100 }] } }), (error) => error.code === "OUTLET_CLOSED"); checks++;
  eq(await prisma.bill.count({ where: { businessId: id } }), 1, "the outlet's history is kept");

  // Reopening takes a slot again: refused when the plan is full.
  await saasService.updateSubscription({ businessId: id, payload: { plan: "starter", subscription_status: "active" } });
  await assert.rejects(outletsService.updateOutlet({ tenantId, outletId: a.id, payload: { status: "active" } }), (error) => error.statusCode === 402); checks++;
  await close(b.id);
  eq((await outletsService.updateOutlet({ tenantId, outletId: a.id, payload: { status: "active" } })).status, "active", "reopens when a slot is free");
  console.log(`Outlet close passed (${checks} checks): open shift, unpaid bills and unfinished transfers block closing; closed outlets take no bills and free their plan slot; reopening respects the plan.`);
} finally {
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
