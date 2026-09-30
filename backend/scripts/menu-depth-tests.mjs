import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { productsService } from "../src/core/products/products.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { ordersService } from "../src/core/orders/orders.service.js";
import { priceRulesService } from "../src/core/menu/price-rules.service.js";
import { isRuleTimeActive, localClock } from "../src/core/menu/menu-pricing.js";
import { qrOrderingService } from "../src/features/sales-extensions/qr-ordering/qr-ordering.service.js";

const suffix = randomUUID().slice(0, 8);
const businessId = `menu-${suffix}`;
const tenantId = `tenant-${businessId}`;
const otherBusinessId = `menu-other-${suffix}`;
const fails = async (promise) => { try { await promise; return null; } catch (error) { return `${error.statusCode}:${error.code || ""}`; } };
const manager = { id: "m1", name: "Mia", role: "Manager" };
const cashier = { id: "c1", name: "Carl", role: "Cashier" };
const stockOf = async (id) => (await prisma.product.findUnique({ where: { id } })).stock;

try {
  await prisma.business.create({ data: { id: businessId, tenantId, name: "Menu depth" } });
  await prisma.business.create({ data: { id: otherBusinessId, tenantId: `tenant-${otherBusinessId}`, name: "Other" } });
  const outletA = await prisma.outlet.create({ data: { businessId, name: "Mall", code: `MA${suffix}` } });
  const outletB = await prisma.outlet.create({ data: { businessId, name: "Airport", code: `AP${suffix}` } });
  const foreignProduct = await prisma.product.create({ data: { businessId: otherBusinessId, name: "Foreign", price: 1, category: "X", stock: 1 } });

  const create = (payload) => productsService.createProduct({ tenantId, payload: { category: "Food", stock: 10, ...payload } });
  const burger = await create({ name: "Burger", price: 200, stock: 5,
    channel_settings: { "Dine-In": { price: 200, active: true }, Takeaway: { price: 200, active: true }, Delivery: { price: 240, active: true } } });
  const fries = await create({ name: "Fries", price: 80 });
  const coke = await create({ name: "Coke", price: 60, category: "Drinks" });
  const meal = await create({
    name: "Burger Meal", price: 300, stock: 0, is_combo: true,
    combo_components: [{ product_id: burger.id, quantity: 1 }, { product_id: fries.id, quantity: 1 }],
    modifier_groups: [
      { name: "Drink", min_select: 1, max_select: 1, options: [{ name: "Coke", price: 0, linked_product_id: coke.id }, { name: "Lemonade", price: 10 }] },
      { name: "Extras", min_select: 0, max_select: 2, options: [{ name: "Cheese", price: 20 }, { name: "Bacon", price: 30 }, { name: "Egg", price: 15 }] },
    ],
  });
  assert.equal(meal.is_combo, true);
  assert.equal(meal.combo_components.length, 2);
  assert.equal(meal.modifier_groups[0].min_select, 1);
  const option = (group, name) => meal.modifier_groups.find((entry) => entry.name === group).options.find((entry) => entry.name === name).id;

  // --- menu API shows what will be charged
  const menu = await productsService.listProducts({ tenantId, query: { outlet_id: outletA.id, channel: "Dine-In" } });
  const menuMeal = menu.find((product) => product.id === meal.id);
  assert.equal(menuMeal.price, 300);
  assert.equal(menuMeal.stock, 5, "a combo can be sold as often as its scarcest component allows");
  assert.equal(menu.find((product) => product.id === burger.id).price, 200);
  assert.equal((await productsService.listProducts({ tenantId, query: { channel: "Delivery" } })).find((product) => product.id === burger.id).price, 240);

  const bill = (user, payload) => billingService.createInvoice({ tenantId, user, payload: { payment_type: "Cash", gst_rate: 0, ...payload } });

  // --- modifier groups and combos
  const mealBill = await bill(manager, { outlet_id: outletA.id, items: [{ id: meal.id, quantity: 1, price: 1,
    modifiers: [option("Drink", "Coke"), option("Extras", "Cheese"), option("Extras", "Bacon")] }] });
  assert.equal(mealBill.total, 350, "300 + Coke 0 + Cheese 20 + Bacon 30, priced by the server");
  assert.match(mealBill.items[0].name, /Burger Meal \(Coke, Cheese, Bacon\)/);
  assert.equal(mealBill.items[0].modifiers.options.length, 3);
  assert.deepEqual(mealBill.items[0].modifiers.combo_components.map((entry) => entry.name).sort(), ["Burger", "Fries"]);
  assert.equal(await stockOf(burger.id), 4, "the combo's burger is consumed");
  assert.equal(await stockOf(fries.id), 9, "the combo's fries are consumed");
  assert.equal(await stockOf(coke.id), 9, "the chosen drink is consumed");
  assert.equal(await stockOf(meal.id), 0, "the combo itself holds no stock");

  assert.equal(await fails(bill(manager, { items: [{ id: meal.id, quantity: 1 }] })), "400:MODIFIER_REQUIRED");
  assert.equal(await fails(bill(manager, { items: [{ id: meal.id, quantity: 1, modifiers: [option("Drink", "Coke"), option("Drink", "Lemonade")] }] })), "400:TOO_MANY_MODIFIERS");
  assert.equal(await fails(bill(manager, { items: [{ id: meal.id, quantity: 1, modifiers: [option("Drink", "Coke"), option("Extras", "Cheese"), option("Extras", "Bacon"), option("Extras", "Egg")] }] })), "400:TOO_MANY_MODIFIERS");
  assert.equal(await fails(bill(manager, { items: [{ id: burger.id, quantity: 1, modifiers: [option("Drink", "Coke")] }] })), "400:UNKNOWN_MODIFIER");
  assert.equal(await fails(bill(manager, { items: [{ id: meal.id, quantity: 1, modifiers: ["made-up"] }] })), "400:UNKNOWN_MODIFIER");

  // An order keeps its choices through to the bill.
  const order = await ordersService.createOrder({ tenantId, actor: cashier, payload: { outlet_id: outletA.id,
    items: [{ id: meal.id, quantity: 2, modifiers: [option("Drink", "Lemonade")] }] } });
  assert.equal(order.total, 620);
  const orderBill = await bill(manager, { order_id: order.id });
  assert.equal(orderBill.total, 620);
  assert.equal(orderBill.items[0].modifiers.options[0].name, "Lemonade");
  assert.equal(await stockOf(burger.id), 2);
  assert.equal(await stockOf(coke.id), 9, "Lemonade is not linked to a product");

  // --- channel prices
  assert.equal((await bill(manager, { service_mode: "DELIVERY", items: [{ id: burger.id, quantity: 1 }] })).total, 240);
  await prisma.product.update({ where: { id: burger.id }, data: { stock: 50 } });

  // --- outlet menus: one source (OutletProduct), outlet price beats channel price
  await productsService.updateProduct({ tenantId, productId: burger.id, payload: { outlet_overrides: [
    { outlet_id: outletA.id, price: 180, status: "active" },
    { outlet_id: outletB.id, price: null, status: "inactive" },
  ] } });
  const links = await prisma.outletProduct.findMany({ where: { productId: burger.id } });
  assert.equal(links.find((link) => link.outletId === outletA.id).priceOverride, 180);
  assert.equal(links.find((link) => link.outletId === outletB.id).enabled, false);
  assert.equal((await bill(manager, { outlet_id: outletA.id, service_mode: "DELIVERY", items: [{ id: burger.id, quantity: 1 }] })).total, 180);
  assert.equal(await fails(bill(manager, { outlet_id: outletB.id, items: [{ id: burger.id, quantity: 1 }] })), "400:PRODUCT_NOT_AT_OUTLET");
  assert.ok(!(await productsService.listProducts({ tenantId, query: { outlet_id: outletB.id, channel: "Dine-In" } })).some((product) => product.id === burger.id));
  const edited = await productsService.getProductById({ tenantId, productId: burger.id });
  assert.equal(edited.outlet_overrides.length, 2, "the Products screen reads the same outlet settings");
  await productsService.updateProduct({ tenantId, productId: burger.id, payload: { outlet_overrides: [] } });
  assert.equal((await bill(manager, { outlet_id: outletB.id, items: [{ id: burger.id, quantity: 1 }] })).total, 200, "leaving an outlet out resets it to normal");
  assert.equal(await fails(productsService.updateProduct({ tenantId, productId: burger.id, payload: { outlet_overrides: [{ outlet_id: "not-mine", price: 1 }] } })), "400:REFERENCE_NOT_IN_BUSINESS");

  // --- happy hours
  const allDay = { start_time: "00:00", end_time: "00:00" };
  const qrHappyHour = await priceRulesService.create({ businessId, tenantId, payload: { name: "QR half price burgers", discount_type: "percent_off", value: 50, ...allDay, channels: ["QR"], product_ids: [burger.id] } });
  assert.equal(qrHappyHour.running_now, true);
  assert.equal((await bill(manager, { items: [{ id: burger.id, quantity: 1 }] })).total, 200, "a QR-only happy hour does not touch counter sales");

  const table = await prisma.diningTable.create({ data: { businessId, name: "T1", meta: { outlet_id: outletA.id } } });
  const qr = await prisma.tableQrCode.create({ data: { businessId, tableId: table.id, token: randomUUID() } });
  await prisma.tableManagementSettings.upsert({ where: { businessId }, create: { businessId, capabilities: { qrOrderingEnabled: true } }, update: { capabilities: { qrOrderingEnabled: true } } });
  const qrMenu = await qrOrderingService.getMenu({ token: qr.token });
  const qrBurger = qrMenu.items.find((product) => product.id === burger.id);
  assert.equal(qrBurger.price, 100, "guests see the happy-hour price");
  assert.equal(qrBurger.price_rule.name, "QR half price burgers");
  const qrOrder = await qrOrderingService.createOrder({ token: qr.token, payload: { customer_name: "Guest", items: [
    { product_id: burger.id, quantity: 2 },
    { product_id: meal.id, quantity: 1, modifier_option_ids: [option("Drink", "Lemonade"), option("Extras", "Egg")] },
  ] } });
  assert.equal(qrOrder.metadata.subtotal, 200 + 325, "QR orders are priced by the same engine");
  assert.equal(await fails(qrOrderingService.createOrder({ token: qr.token, payload: { items: [{ product_id: meal.id, quantity: 1 }] } })), "400:MODIFIER_REQUIRED");

  // The best matching rule wins; rules outside their window or dates do nothing.
  await priceRulesService.create({ businessId, tenantId, payload: { name: "Food 30 off", discount_type: "amount_off", value: 30, ...allDay, categories: ["Food"] } });
  assert.equal((await bill(manager, { items: [{ id: burger.id, quantity: 1 }] })).total, 170);
  const now = localClock(new Date(), "Asia/Kolkata");
  const laterStart = (now.minute + 120) % 1440;
  await priceRulesService.create({ businessId, tenantId, payload: { name: "Not yet", discount_type: "fixed_price", value: 1, start_time: laterStart, end_time: (laterStart + 30) % 1440, product_ids: [burger.id] } });
  await priceRulesService.create({ businessId, tenantId, payload: { name: "Expired", discount_type: "fixed_price", value: 1, ...allDay, product_ids: [burger.id], valid_from: "2020-01-01", valid_to: "2020-02-01" } });
  assert.equal((await bill(manager, { items: [{ id: burger.id, quantity: 1 }] })).total, 170);

  // A bill rung up offline is priced by the rules in force when it was taken.
  const windowStart = (now.minute + 1440 - 90) % 1440;
  await priceRulesService.create({ businessId, tenantId, payload: { name: "Earlier today", discount_type: "fixed_price", value: 40, start_time: windowStart, end_time: (windowStart + 30) % 1440, product_ids: [fries.id] } });
  const offlineAt = new Date(Date.now() - 75 * 60 * 1000).toISOString();
  assert.equal((await bill(manager, { offline_created_at: offlineAt, items: [{ id: fries.id, quantity: 1 }] })).total, 40);
  assert.equal((await bill(manager, { items: [{ id: fries.id, quantity: 1 }] })).total, 50, "now only the all-day Food 30 off applies");

  // Overnight windows (22:00-02:00 on Fridays) and time zones.
  const overnight = { active: true, daysOfWeek: [5], startMinute: 22 * 60, endMinute: 2 * 60, timezone: "Asia/Kolkata" };
  assert.equal(isRuleTimeActive(overnight, new Date("2026-10-02T17:00:00Z")), true, "Friday 22:30 IST");
  assert.equal(isRuleTimeActive(overnight, new Date("2026-10-02T20:00:00Z")), true, "Saturday 01:30 IST still belongs to Friday night");
  assert.equal(isRuleTimeActive(overnight, new Date("2026-10-03T17:00:00Z")), false, "Saturday 22:30 IST is not Friday");
  assert.equal(isRuleTimeActive(overnight, new Date("2026-10-02T12:00:00Z")), false, "Friday 17:30 IST is outside the window");

  // --- rule validation
  assert.equal(await fails(priceRulesService.create({ businessId, tenantId, payload: { name: "x", discount_type: "percent_off", value: 150, ...allDay } })), "400:INVALID_VALUE");
  assert.equal(await fails(priceRulesService.create({ businessId, tenantId, payload: { name: "x", discount_type: "percent_off", value: 10, ...allDay, channels: ["Zomato"] } })), "400:INVALID_CHANNEL");
  assert.equal(await fails(priceRulesService.create({ businessId, tenantId, payload: { name: "x", discount_type: "percent_off", value: 10, ...allDay, product_ids: [foreignProduct.id] } })), "400:REFERENCE_NOT_IN_BUSINESS");
  assert.equal(await fails(priceRulesService.create({ businessId, tenantId, payload: { name: "x", discount_type: "percent_off", value: 10, start_time: "25:00", end_time: "10:00" } })), "400:INVALID_TIME");
  assert.equal(await fails(priceRulesService.update({ businessId: otherBusinessId, tenantId, ruleId: qrHappyHour.id, payload: { value: 90 } })), "404:NOT_FOUND", "another business cannot edit this rule");

  // --- structure rules
  assert.equal(await fails(productsService.deleteProduct({ tenantId, productId: fries.id })), "409:PRODUCT_IN_COMBO");
  assert.equal(await fails(productsService.updateProduct({ tenantId, productId: burger.id, payload: { is_combo: true, combo_components: [{ product_id: coke.id }] } })), "400:COMBO_NESTED");
  assert.equal(await fails(create({ name: "Loop", price: 1, is_combo: true, combo_components: [{ product_id: meal.id }] })), "400:COMBO_NESTED");
  assert.equal(await fails(create({ name: "Bad group", price: 1, modifier_groups: [{ name: "Pick", min_select: 3, max_select: 1, options: [{ name: "A" }] }] })), "400:INVALID_MAX");
  assert.equal(await fails(create({ name: "Foreign link", price: 1, modifier_groups: [{ name: "Pick", options: [{ name: "A", linked_product_id: foreignProduct.id }] }] })), "400:REFERENCE_NOT_IN_BUSINESS");

  console.log("Menu depth passed: modifier groups, combos, channel and outlet prices, happy hours, QR parity, validation");
} finally {
  await prisma.comboComponent.deleteMany({ where: { combo: { businessId } } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.$disconnect();
}
