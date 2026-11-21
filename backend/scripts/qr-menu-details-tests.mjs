import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { productsService } from "../src/core/products/products.service.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { tableManagementService } from "../src/features/sales-extensions/table-management/table-management.service.js";
import { qrOrderingService } from "../src/features/sales-extensions/qr-ordering/qr-ordering.service.js";
import { kotService } from "../src/features/kitchen/kot/kot.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";
import { ingredientAllergensService } from "../src/core/products/ingredient-allergens.js";

const id = `qr-food-${randomUUID()}`, tenantId = `tenant-${id}`, api = http.createServer(app);
const previous = env.admincore.enabled;
let checks = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
try {
  env.admincore.enabled = false;
  await prisma.business.create({ data: { id, tenantId, name: "QR food fixture" } });
  await saasService.updateSubscription({ businessId: id, payload: { plan: "growth", subscription_status: "active" } });
  await prisma.tableManagementSettings.create({ data: { businessId: id, capabilities: { qrOrderingEnabled: true } } });
  const product = await productsService.createProduct({ tenantId, payload: {
    name: "Toast", category: "Food", price: 20, stock: 3,
    channel_settings: { qr: { enabled: true, description: "Fresh toast", allergens: ["Wheat", "Milk"], may_contain: ["Nuts"], allergens_reviewed: true, enforce_stock: true } },
    variation_options: [{ name: "Large", price: 5 }],
    addon_options: [{ name: "Cheese", price: 4 }],
    modifier_groups: [{ name: "Toast level", min_select: 1, max_select: 1, options: [{ name: "Light", price: 0 }, { name: "Crispy", price: 2 }, { name: "Unavailable", price: 0, active: false }] }],
  } });
  await productsService.updateProduct({ tenantId, productId: product.id, payload: { channel_settings: { "Delivery": { active: false } } } });
  const saved = await productsService.getProductById({ tenantId, productId: product.id });
  eq(saved.channel_settings.qr.description, "Fresh toast");
  await assert.rejects(productsService.updateProduct({ tenantId, productId: product.id, payload: { channel_settings: { qr: { allergens: "Milk" } } } })); checks++;
  eq((await productsService.getProductById({ tenantId, productId: product.id })).channel_settings.qr.allergens, ["Wheat", "Milk"]);
  const table = await prisma.diningTable.create({ data: { businessId: id, name: "T-food" } });
  const qr = await tableManagementService.upsertTableQrCode({ businessId: id, tenantId, tableId: table.id });
  const first = await qrOrderingService.getMenu({ token: qr.token });
  eq(first.items[0].description, "Fresh toast"); eq(first.items[0].allergens, ["Wheat", "Milk"]); eq(first.items[0].may_contain, ["Nuts"]);
  eq(first.items[0].qr_availability.max_quantity, 3);
  const ingredient = await prisma.inventoryItem.create({ data: { businessId: id, name: "Ingredient fixture", unit: "kg" } });
  const settings = { businessId: id, ingredientId: ingredient.id, user: { id: "fixture-reviewer" } };
  await prisma.product.update({ where: { id: product.id }, data: { recipeLines: [{ inventory_id: ingredient.id, quantity: 0.01, unit: "kg" }] } });
  const derived = () => qrOrderingService.getMenu({ token: qr.token, requestMeta: { refresh: true } });
  eq((await derived()).items[0].allergens_reviewed, false);
  await ingredientAllergensService.save({ ...settings, payload: { allergens: ["Soy"], may_contain: ["Sesame"], reviewed: true } });
  let dish = (await derived()).items[0];
  eq(dish.allergens, ["Wheat", "Milk", "Soy"]); eq(dish.may_contain, ["Nuts", "Sesame"]); eq(dish.allergens_reviewed, true);
  await ingredientAllergensService.save({ ...settings, payload: { allergens: ["Egg"], may_contain: [], reviewed: false } });
  dish = (await derived()).items[0]; eq(dish.allergens.includes("Egg"), true); eq(dish.allergens.includes("Soy"), false); eq(dish.allergens_reviewed, false);
  await assert.rejects(ingredientAllergensService.save({ ...settings, payload: { allergens: "Egg", reviewed: true } })); checks++;
  await assert.rejects(ingredientAllergensService.save({ ...settings, businessId: "wrong-business", payload: { reviewed: true } })); checks++;
  // Optional add-on recipes are included even before a customer selects them.
  await prisma.product.update({ where: { id: product.id }, data: { recipeLines: [] } });
  await prisma.addon.update({ where: { id: product.addon_options[0].id }, data: { recipeLines: [{ inventory_id: ingredient.id, quantity: 0.01, unit: "kg" }] } });
  eq((await derived()).items[0].allergens.includes("Egg"), true);
  await prisma.addon.update({ where: { id: product.addon_options[0].id }, data: { recipeLines: [] } });
  const linked = await prisma.product.create({ data: { businessId: id, name: "ZZ linked ingredient product", price: 1, category: "Food", stock: 10, active: false,
    recipeLines: [{ inventory_id: ingredient.id, quantity: 0.01, unit: "kg" }], channelSettings: { qr: { enabled: false, allergens_reviewed: true } } } });
  await prisma.addon.update({ where: { id: product.addon_options[0].id }, data: { linkedProductId: linked.id } });
  eq((await derived()).items[0].allergens.includes("Egg"), true);
  await ingredientAllergensService.save({ ...settings, payload: { allergens: ["Egg"], may_contain: [], reviewed: true } });
  eq((await derived()).items[0].allergens_reviewed, true);
  const combo = await prisma.product.create({ data: { businessId: id, name: "ZZ Combo", price: 30, category: "Food", isCombo: true,
    channelSettings: { qr: { allergens_reviewed: true } }, comboComponents: { create: [{ componentProductId: product.id, quantity: 1 }] } } });
  eq((await derived()).items.find((row) => row.id === combo.id).allergens.includes("Egg"), true);
  // A cyclic legacy menu must remain unconfirmed rather than recurse indefinitely.
  await prisma.addon.update({ where: { id: product.addon_options[0].id }, data: { linkedProductId: product.id } });
  eq((await derived()).items[0].allergens_reviewed, false);
  await prisma.addon.update({ where: { id: product.addon_options[0].id }, data: { linkedProductId: null } });
  await prisma.product.update({ where: { id: combo.id }, data: { active: false } });
  const visit = await prisma.tableSession.findUnique({ where: { id: first.table_session.id } });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${api.address().port}/api/public/qr/${qr.token}`;
  const menu = async () => (await (await fetch(`${base}/menu?refresh=1`)).json()).data;
  await menu();
  eq((await prisma.tableSession.findUnique({ where: { id: visit.id } })).metadata.scan_count, visit.metadata.scan_count);
  const group = product.modifier_groups[0];
  const line = { product_id: product.id, quantity: 1, variation_id: product.variation_options[0].id, addon_ids: [product.addon_options[0].id], modifier_option_ids: [group.options[1].id], kitchen_note: "Less salt please", quoted_unit_price: 31 };
  const send = async (items, requestId = randomUUID()) => {
    const response = await fetch(`${base}/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_name: "Food guest", items, client_request_id: requestId }) });
    return { status: response.status, data: (await response.json()).data };
  };
  eq((await send([{ ...line, modifier_option_ids: [] }])).status, 400);
  eq((await send([{ ...line, modifier_option_ids: [group.options[2].id] }])).status, 400);
  eq((await send([{ ...line, kitchen_note: "x".repeat(201) }])).status, 400);
  eq((await send([{ ...line, quoted_unit_price: 1 }])).status, 409);
  eq((await send([{ ...line, quantity: 2 }, { ...line, variation_id: null, quantity: 2, quoted_unit_price: 26 }])).status, 409);
  const requestId = randomUUID();
  const order = await send([line], requestId); eq(order.status, 201); eq(order.data.total, 31);
  eq(order.data.items[0].modifiers.kitchen_note, "Less salt please");
  await qrOrderingService.approveOrder({ tenantId, businessId: id, orderId: order.data.id });
  const ticket = await prisma.kitchenTicket.findUnique({ where: { orderId: order.data.id } });
  const kitchen = kotService.serializeTicket(await kotService.getTicket({ tenantId, ticketId: ticket.id }));
  eq(kitchen.items[0].kitchen_note, "Less salt please");
  eq(kitchen.print_payload.payload.station_groups[0].items[0].kitchen_note, "Less salt please");
  await productsService.updateProduct({ tenantId, productId: product.id, payload: { channel_settings: { qr: { sold_out: true } } } });
  eq((await menu()).items[0].qr_availability.available, false);
  eq((await send([line])).status, 409);
  eq((await send([line], requestId)).data.id, order.data.id);
  await productsService.updateProduct({ tenantId, productId: product.id, payload: { channel_settings: { qr: { sold_out: false, enabled: false } } } });
  eq((await menu()).items.length, 0); eq((await send([line])).status, 400);
  await prisma.tableSession.update({ where: { id: visit.id }, data: { status: "closed", closedAt: new Date() } });
  await menu(); eq((await prisma.tableSession.findUnique({ where: { id: visit.id } })).status, "closed");
  console.log(`QR menu details passed: ${checks} checks for saved allergens, settings preservation, choice rules/prices, kitchen requests/print, stock limits, sold-out/hidden items and side-effect-free refresh.`);
} finally {
  env.admincore.enabled = previous;
  if (api.listening) await new Promise((resolve) => api.close(resolve));
  await prisma.comboComponent.deleteMany({ where: { combo: { businessId: id } } });
  await prisma.business.deleteMany({ where: { id } });
  await prisma.stateDocument.deleteMany({ where: { OR: [{ key: { contains: id } }, { data: { path: ["business_id"], equals: id } }] } });
  await stopRealtime(); await prisma.$disconnect();
}
