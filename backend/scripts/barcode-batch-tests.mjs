// Product barcodes (unique per business, valid in-store EAN-13, plan-gated) and batch tracking (lots recorded at
// receiving, linked to the stock item and location, estimated remaining by earliest-expiry-first, expiry alerts).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { productsService } from "../src/core/products/products.service.js";
import { barcodeService } from "../src/features/barcode/barcode.service.js";
import { isValidEan13 } from "../src/features/barcode/barcode-rules.js";
import { inventoryOperationsService as operations } from "../src/core/inventory/inventory-operations.service.js";
import { batchTrackingService } from "../src/features/inventory-advanced/batch-tracking/batch-tracking.service.js";
import { moveStock } from "../src/core/inventory/stock-ledger.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8), rich = `bb-ent-${suffix}`, basic = `bb-start-${suffix}`;
const scope = (id) => ({ tenantId: `tenant-${id}` });
const owner = { role: "Owner", name: "Owner" };
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const rejects = async (promise, test) => { await assert.rejects(promise, test); checks++; };
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
try {
  await connectDatabase();
  for (const [id, plan] of [[rich, "enterprise"], [basic, "starter"]]) {
    await prisma.business.create({ data: { id, tenantId: scope(id).tenantId, name: "Barcode fixture" } });
    await saasService.updateSubscription({ businessId: id, payload: { plan, subscription_status: "active" } });
  }
  // Barcodes.
  const water = await productsService.createProduct({ ...scope(rich), payload: { name: "Bottled water", price: 20, stock: 50, barcode: " 8901234567890 " } });
  eq(water.barcode, "8901234567890", "a manufacturer barcode is stored trimmed");
  await rejects(productsService.createProduct({ ...scope(rich), payload: { name: "Soda", price: 30, stock: 10, barcode: "8901234567890" } }), (error) => error.code === "BARCODE_IN_USE" && /Bottled water/.test(error.message));
  await rejects(productsService.createProduct({ ...scope(rich), payload: { name: "Juice", price: 30, stock: 10, barcode: "bad code!" } }), (error) => error.code === "BARCODE_INVALID");
  await rejects(productsService.createProduct({ ...scope(basic), payload: { name: "Water", price: 20, stock: 10, barcode: "12345678" } }), (error) => error.code === "FEATURE_DISABLED");
  const cookie = await productsService.createProduct({ ...scope(rich), payload: { name: "House cookie", price: 40, stock: 30 } });
  const generated = await barcodeService.generateBarcode({ ...scope(rich), payload: { product_id: cookie.id } });
  eq([generated.generated, generated.barcode.startsWith("20"), isValidEan13(generated.barcode)], [true, true, true], "in-store codes are valid EAN-13 in the 20 range");
  eq((await barcodeService.generateBarcode({ ...scope(rich), payload: { product_id: cookie.id } })).barcode, generated.barcode, "generating again keeps the code");
  eq((await barcodeService.listBarcodes(scope(rich))).items.map((row) => row.name), ["Bottled water", "House cookie"]);
  eq((await productsService.updateProduct({ ...scope(rich), productId: water.id, payload: { barcode: "" } })).barcode, null, "a barcode can be removed");
  eq((await barcodeService.listBarcodes(scope(rich))).items.length, 1);

  // Batches: lots recorded at receiving, at the right location.
  const outlet = await prisma.outlet.create({ data: { businessId: rich, name: "Main", code: `M${suffix}` } });
  const milk = await prisma.inventoryItem.create({ data: { businessId: rich, name: "Milk", unit: "l", stock: 0 } });
  const receive = (items, location = "central") => operations.receivePurchase({ ...scope(rich), user: owner, payload: { outlet_id: outlet.id, stock_location: location, request_id: randomUUID(), vendor_name: "Dairy", items } });
  await rejects(receive([{ inventory_id: milk.id, quantity: 5, unit_cost: 50, batch_no: "L-1" }]), (error) => /expiry/.test(error.message));
  await receive([{ inventory_id: milk.id, quantity: 10, unit_cost: 50, batch_no: "L-EARLY", expiry_date: day(5) }]);
  await receive([{ inventory_id: milk.id, quantity: 5, unit_cost: 55, batch_no: "L-LATE", expiry_date: day(30) }]);
  await receive([{ inventory_id: milk.id, quantity: 4, unit_cost: 50, batch_no: "L-OUT", expiry_date: day(-1) }], "outlet");
  const flourBasic = await prisma.inventoryItem.create({ data: { businessId: basic, name: "Flour", unit: "kg" } });
  const basicOutlet = await prisma.outlet.create({ data: { businessId: basic, name: "Main", code: `B${suffix}` } });
  await rejects(operations.receivePurchase({ ...scope(basic), user: owner, payload: { outlet_id: basicOutlet.id, stock_location: "central", items: [{ inventory_id: flourBasic.id, quantity: 1, batch_no: "X", expiry_date: day(10) }] } }), (error) => error.code === "FEATURE_DISABLED");
  // Use 8 l at the central store: earliest-expiry-first leaves 2 l of the early lot and all 5 l of the late lot.
  await prisma.$transaction((tx) => moveStock({ tx, businessId: rich, itemId: milk.id, outletId: null, movementType: "consumption", quantity: -8, reason: "Test use" }));
  const list = await batchTrackingService.listBatches(scope(rich));
  const byNo = Object.fromEntries(list.items.map((row) => [row.batch_no, row]));
  eq([byNo["L-EARLY"].estimated_remaining, byNo["L-LATE"].estimated_remaining], [2, 5]);
  eq([byNo["L-EARLY"].status, byNo["L-LATE"].status, byNo["L-OUT"].status], ["expiring", "ok", "expired"]);
  eq([byNo["L-OUT"].location, byNo["L-EARLY"].location], ["Main", "Central kitchen"]);
  eq(byNo["L-LATE"].unit_cost, 55);
  eq(list.alerts, { expired: 1, expiring: 1 });
  eq((await batchTrackingService.listBatches({ ...scope(rich), outletIds: [outlet.id] })).items.map((row) => row.batch_no), ["L-OUT"], "outlet staff see only their outlet's lots");
  // Recording a lot for stock already on hand does not change stock.
  await batchTrackingService.createBatch({ ...scope(rich), payload: { inventory_id: milk.id, batch_no: "L-OLD", expiry_date: day(3), quantity: 1 } });
  eq((await prisma.inventoryItem.findUnique({ where: { id: milk.id } })).stock, 7);
  await rejects(batchTrackingService.createBatch({ ...scope(rich), payload: { inventory_id: flourBasic.id, batch_no: "X", expiry_date: day(3), quantity: 1 } }), (error) => error.statusCode === 404);
  console.log(`Barcodes and batches passed (${checks} checks): unique plan-gated barcodes, in-store EAN-13, lots recorded at receiving with location and cost, earliest-expiry-first remaining, expiry alerts, outlet scope.`);
} finally {
  await prisma.stateDocument.deleteMany({ where: { key: { contains: suffix } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id: { in: [rich, basic] } } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
