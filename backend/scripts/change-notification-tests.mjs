import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { productsService } from "../src/core/products/products.service.js";
import { inventoryService } from "../src/core/inventory/inventory.service.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";
import { syncService } from "../src/core/sync/sync.service.js";

const businessId = `change-test-${randomUUID()}`;
const tenantId = `tenant-${businessId}`;
const events = [];
const original = admincoreChangeSyncService.notifyChange;
admincoreChangeSyncService.notifyChange = async (event) => { events.push(event); return { queued: true }; };
try {
  await prisma.business.create({ data: { id: businessId, tenantId, name: "Change contract test" } });
  const product = await productsService.createProduct({ tenantId, payload: { name: "Test product", price: 30 } });
  await productsService.getProductById({ tenantId, productId: product.id });
  assert.deepEqual(events.map((event) => event.action), ["created"]);
  await productsService.updateProduct({ tenantId, productId: product.id, payload: { price: 40 } });
  await productsService.deleteProduct({ tenantId, productId: product.id });
  assert.deepEqual(events.map((event) => event.action), ["created", "updated", "deleted"]);
  events.length = 0;
  const item = await inventoryService.createItem({ tenantId, payload: { name: "Test stock", stock: 4, unit: "kg" } });
  await inventoryService.getItemById({ tenantId, itemId: item.id });
  assert.deepEqual(events.map((event) => event.action), ["created"]);
  await inventoryService.updateItem({ tenantId, itemId: item.id, payload: { stock: 9 } });
  await inventoryService.deleteItem({ tenantId, itemId: item.id });
  assert.deepEqual(events.map((event) => event.action), ["created", "updated", "deleted"]);
  assert.ok(events.every((event) => event.businessId === businessId && event.tenantId === tenantId));
  await prisma.product.createMany({ data: [1, 2, 3].map((i) => ({ businessId, name: `Paged ${i}`, category: "test", price: i })) });
  const first = await syncService.exportResource({ resource: "products", tenantId, businessId, query: { limit: 2 } });
  const second = await syncService.exportResource({ resource: "products", tenantId, businessId, query: { limit: 2, offset: first.meta.pagination.next_offset } });
  assert.equal(first.meta.pagination.has_more, true);
  assert.equal(second.meta.pagination.has_more, false);
  assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 3);
  console.log("Product/inventory event actions, read silence, business scope and export pagination passed");
} finally {
  admincoreChangeSyncService.notifyChange = original;
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.$disconnect();
}
