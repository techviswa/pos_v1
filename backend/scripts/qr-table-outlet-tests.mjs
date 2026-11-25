// QR orders must belong to the outlet that serves the table: that outlet's stock, invoice series and cash drawer.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { qrOrderingService } from "../src/features/sales-extensions/qr-ordering/qr-ordering.service.js";
import { tableManagementService } from "../src/features/sales-extensions/table-management/table-management.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8);
const ids = { one: `qr-outlet-one-${suffix}`, many: `qr-outlet-many-${suffix}`, none: `qr-outlet-none-${suffix}`, foreign: `qr-outlet-foreign-${suffix}` };
const scope = (businessId) => ({ businessId, tenantId: `tenant-${businessId}` });
const order = (token) => qrOrderingService.createOrder({ token, payload: { customer_name: "Guest", client_request_id: randomUUID(), items: [{ product_id: products.get(token), quantity: 1 }] } });
const products = new Map();

const setup = async (businessId, outletCount) => {
  await prisma.business.create({ data: { id: businessId, tenantId: scope(businessId).tenantId, name: "QR outlet fixture" } });
  await saasService.updateSubscription({ businessId, payload: { plan: "growth", subscription_status: "active" } });
  await prisma.tableManagementSettings.create({ data: { businessId, capabilities: { qrOrderingEnabled: true }, reservationRules: { qrOrderingRules: { requireRestaurantApproval: true } } } });
  const outlets = [];
  for (let i = 0; i < outletCount; i++) outlets.push(await prisma.outlet.create({ data: { businessId, name: `Outlet ${i + 1}`, code: `Q${i}${suffix}` } }));
  const product = await prisma.product.create({ data: { businessId, name: "Tea", category: "Drinks", price: 50, stock: 100, active: true } });
  const qrFor = async (meta = {}) => {
    const table = await prisma.diningTable.create({ data: { businessId, name: `T-${randomUUID().slice(0, 4)}`, meta } });
    const qr = await tableManagementService.upsertTableQrCode({ ...scope(businessId), tableId: table.id });
    products.set(qr.token, product.id);
    return qr.token;
  };
  return { outlets, qrFor };
};

let checks = 0;
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
try {
  await connectDatabase();
  const one = await setup(ids.one, 1);
  const many = await setup(ids.many, 2);
  const none = await setup(ids.none, 0);
  const foreign = await setup(ids.foreign, 1);

  // One outlet: an unlinked table is served by it, so the order uses its stock and cash drawer.
  const unlinked = await one.qrFor();
  eq((await qrOrderingService.getMenu({ token: unlinked, requestMeta: { refresh: true } })).availability.outlet_id, one.outlets[0].id, "menu availability is checked at the only outlet");
  const placed = await order(unlinked);
  eq((await prisma.order.findUnique({ where: { id: placed.id } })).outletId, one.outlets[0].id, "an unlinked table's order belongs to the only outlet");

  // Several outlets: a linked table uses its outlet; an unlinked one cannot take orders (whose stock? whose drawer?).
  const linked = await many.qrFor({ outlet_id: many.outlets[1].id });
  eq((await prisma.order.findUnique({ where: { id: (await order(linked)).id } })).outletId, many.outlets[1].id, "a linked table's order goes to its outlet");
  await assert.rejects(order(await many.qrFor()), (error) => error.code === "TABLE_OUTLET_REQUIRED" && error.statusCode === 409); checks++;

  // No outlets at all: business-level tables keep working.
  eq((await prisma.order.findUnique({ where: { id: (await order(await none.qrFor())).id } })).outletId, null, "a business without outlets still takes QR orders");

  // A table pointing at another business's outlet is refused, both when ordering and when saving the table.
  const forged = await one.qrFor({ outlet_id: foreign.outlets[0].id });
  await assert.rejects(order(forged), (error) => error.code === "TABLE_OUTLET_INVALID"); checks++;
  await assert.rejects(tableManagementService.createTable({ ...scope(ids.one), payload: { name: `X-${suffix}`, meta: { outlet_id: foreign.outlets[0].id } } }), (error) => error.statusCode === 400); checks++;
  const saved = await tableManagementService.createTable({ ...scope(ids.many), payload: { name: `Y-${suffix}`, meta: { outlet_id: many.outlets[0].id, notes: "Patio" } } });
  eq(saved.meta.outlet_id, many.outlets[0].id, "a table can be linked to the business's own outlet");

  console.log(`QR table outlet passed (${checks} checks): unlinked tables use a sole outlet, linked tables use theirs, ambiguous and foreign outlets are refused, outlet-less businesses still order.`);
} finally {
  await prisma.business.deleteMany({ where: { id: { in: Object.values(ids) } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: suffix } } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
