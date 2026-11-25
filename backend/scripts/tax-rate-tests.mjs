// Bills are taxed at the rate saved in Settings (what the till shows), unless a manager overrides it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "../src/config/db.js";
import prisma from "../src/database/prisma/client.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { updateBusinessProfile, readBusinessProfile } from "../src/core/businesses/business-profile.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const id = `tax-rate-${randomUUID().slice(0, 8)}`, tenantId = `tenant-${id}`;
try {
  await connectDatabase();
  const business = await prisma.business.create({ data: { id, tenantId, name: "Tax rate fixture" } });
  const product = await prisma.product.create({ data: { businessId: id, name: "Thali", category: "Food", price: 1000, stock: 50 } });
  const item = [{ productId: product.id, name: product.name, quantity: 1, price: 1000 }];
  const cashier = { id: "cashier", role: "Cashier", name: "Cashier" };
  const manager = { id: "manager", role: "Manager", name: "Manager" };
  assert.equal((await billingService.createInvoice({ tenantId, user: cashier, payload: { items: item, payment_type: "Cash" } })).tax, 180, "the default profile rate is 18%");
  await updateBusinessProfile(id, { taxRate: 5, expected_updated_at: business.updatedAt.toISOString() });
  assert.equal((await readBusinessProfile(id)).taxRate, 5);
  const fivePercent = await billingService.createInvoice({ tenantId, user: cashier, payload: { items: item, payment_type: "Cash" } });
  assert.equal(fivePercent.tax, 50, "a 5% business bills 5%, as its till shows");
  assert.equal(fivePercent.total, 1050);
  const forged = await billingService.createInvoice({ tenantId, user: cashier, payload: { items: item, payment_type: "Cash", gst_rate: 0 } });
  assert.equal(forged.tax, 50, "a cashier cannot change the tax rate");
  const override = await billingService.createInvoice({ tenantId, user: manager, payload: { items: item, payment_type: "Cash", gst_rate: 12 } });
  assert.equal(override.tax, 120, "a manager may override the rate for one bill");
  console.log("Tax rate passed: bills use the Settings rate, cashiers cannot override it, managers can.");
} finally {
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
