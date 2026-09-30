import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { ordersService } from "../src/core/orders/orders.service.js";
import { mutateBillPayment } from "../src/core/billing/billing-payments.service.js";
import { paymentsService } from "../src/core/payments/payments.service.js";

const suffix = randomUUID();
const businessId = `billing-int-${suffix}`;
const otherBusinessId = `billing-int-other-${suffix}`;
const tenantId = `tenant-${businessId}`;
const fails = async (promise) => { try { await promise; return null; } catch (error) { return `${error.statusCode}:${error.code || ""}`; } };

try {
  await prisma.business.create({ data: { id: businessId, tenantId, name: "Billing integrity" } });
  await prisma.business.create({ data: { id: otherBusinessId, tenantId: `tenant-${otherBusinessId}`, name: "Other" } });
  const outlet = await prisma.outlet.create({ data: { businessId, name: "Main", code: `M${Date.now()}` } });
  const foreignOutlet = await prisma.outlet.create({ data: { businessId: otherBusinessId, name: "Foreign", code: `F${Date.now()}` } });
  const role = await prisma.role.upsert({ where: { name: "Manager" }, update: {}, create: { name: "Manager" } });
  const mkUser = (email, name) => prisma.user.create({ data: { businessId, roleId: role.id, name, email, passwordHash: "x", active: true } });
  const managerRow = await mkUser("m@t.test", "Mia Manager");
  const cashierRow = await mkUser("c@t.test", "Carl Cashier");
  const manager = { id: managerRow.id, name: managerRow.name, role: "Manager", permissions: ["billing", "bills"] };
  const cashier = { id: cashierRow.id, name: cashierRow.name, role: "Cashier", permissions: ["billing", "bills"] };

  const product = await prisma.product.create({
    data: {
      businessId, name: "Burger", price: 100, category: "Food", stock: 1000,
      variations: { create: [{ name: "Large", price: 30 }] },
      addons: { create: [{ name: "Cheese", price: 20 }] },
    },
    include: { variations: true, addons: true },
  });
  const foreignProduct = await prisma.product.create({ data: { businessId: otherBusinessId, name: "Foreign burger", price: 1, category: "Food", stock: 5 } });
  const bill = (user, payload) => billingService.createInvoice({ tenantId, user, payload: { payment_type: "Cash", ...payload } });
  const stock = async () => (await prisma.product.findUnique({ where: { id: product.id } })).stock;

  // 1. Prices come from the catalogue.
  const cheap = await bill(cashier, { items: [{ productId: product.id, quantity: 2, price: 0.01, name: "Burger" }] });
  assert.equal(cheap.total, 236, "2 x 100 + 18% GST, whatever price the client claimed");
  assert.equal(await stock(), 998);

  // The POS screen sends `id` (not productId), a variation name and add-on names.
  const configured = await bill(cashier, { items: [{ id: product.id, quantity: 1, price: 1, variation: "Large", addons: ["Cheese"], name: "Burger Large + Cheese" }] });
  assert.equal(configured.subtotal, 150);
  assert.equal(await stock(), 997, "stock is deducted by product id, not by matching a display name");
  assert.equal(await fails(bill(cashier, { items: [{ id: product.id, quantity: 1, variation: "Huge" }] })), "400:UNKNOWN_VARIATION");
  assert.equal(await fails(bill(cashier, { items: [{ id: product.id, quantity: 1, addons: ["Gold leaf"] }] })), "400:UNKNOWN_ADDON");

  // 2. Tax rate is a manager decision and is clamped.
  assert.equal((await bill(cashier, { gst_rate: -100, items: [{ id: product.id, quantity: 1 }] })).tax, 18);
  assert.equal((await bill(manager, { gst_rate: 5, items: [{ id: product.id, quantity: 1 }] })).total, 105);
  assert.equal((await bill(manager, { gst_rate: -100, items: [{ id: product.id, quantity: 1 }] })).tax, 0);

  // 3. Big discounts need a manager.
  assert.equal(await fails(bill(cashier, { discount_type: "percent", discount_value: 100, items: [{ id: product.id, quantity: 1 }] })), "403:DISCOUNT_APPROVAL_REQUIRED");
  assert.equal((await bill(cashier, { discount_type: "percent", discount_value: 20, items: [{ id: product.id, quantity: 1 }] })).total, 94.4);
  assert.equal((await bill(manager, { discount_type: "percent", discount_value: 100, items: [{ id: product.id, quantity: 1 }] })).total, 0);

  // 4. Forged status / refund / void / author / shift metadata is dropped.
  const forged = await bill(cashier, {
    items: [{ id: product.id, quantity: 1 }],
    status: "void",
    refunded_amount: 999,
    refunds: [{ amount: 50, method: "cash", settlement_shift_id: "fake-shift" }],
    void_status: "approved",
    void_approved_by: "someone",
    created_by: "someone-else",
    created_by_name: "Boss",
    created_by_role: "Owner",
    created_at: "2001-01-01T00:00:00.000Z",
    payment_status: "paid",
    shift_id: "fake",
  });
  assert.equal(forged.status, "issued");
  assert.equal(forged.refunded_amount ?? 0, 0);
  assert.deepEqual(forged.refunds ?? [], []);
  assert.notEqual(forged.void_status, "approved");
  assert.equal(forged.created_by, cashier.id);
  assert.notEqual(forged.shift_id, "fake");

  // 5. Retry safety.
  const before = await prisma.bill.count({ where: { businessId } });
  const stockBefore = await stock();
  const first = await bill(cashier, { client_request_id: "checkout-1", items: [{ id: product.id, quantity: 1 }] });
  const replay = await bill(cashier, { client_request_id: "checkout-1", items: [{ id: product.id, quantity: 1 }] });
  assert.equal(replay.id, first.id, "the same checkout returns the same bill");
  assert.equal(await prisma.bill.count({ where: { businessId } }), before + 1);
  assert.equal(await stock(), stockBefore - 1, "stock is deducted once");
  const [a, b] = await Promise.all([
    bill(cashier, { client_request_id: "checkout-race", items: [{ id: product.id, quantity: 1 }] }),
    bill(cashier, { client_request_id: "checkout-race", items: [{ id: product.id, quantity: 1 }] }),
  ]);
  assert.equal(a.id, b.id, "two simultaneous submissions still create one bill");
  assert.equal(await stock(), stockBefore - 2);

  // 6. Quantities and items are validated.
  for (const quantity of [0, -3, 1.5, "abc", 1000]) {
    assert.equal(await fails(bill(cashier, { items: [{ id: product.id, quantity }] })), "400:INVALID_QUANTITY", `quantity ${quantity}`);
  }
  assert.equal(await fails(bill(cashier, { items: [] })), "400:BILL_ITEMS_REQUIRED");
  assert.equal(await fails(bill(cashier, { subtotal: 5000, items: [] })), "400:BILL_ITEMS_REQUIRED", "a bill cannot be a bare client-supplied total");
  assert.equal(await fails(bill(cashier, { items: [{ id: foreignProduct.id, quantity: 1 }] })), "400:UNKNOWN_PRODUCT", "a product of another tenant");
  assert.equal(await fails(bill(cashier, { items: [{ name: "Free lunch", price: 0, quantity: 1 }] })), "400:PRODUCT_REQUIRED", "open-priced items are for managers");
  assert.equal((await bill(manager, { items: [{ name: "Custom cake", price: 500, quantity: 1 }] })).subtotal, 500);
  assert.equal(await fails(bill(cashier, { outlet_id: foreignOutlet.id, items: [{ id: product.id, quantity: 1 }] })), "400:REFERENCE_NOT_IN_BUSINESS");

  // 7. Orders: server-side pricing, no reserved channel or kitchen-owned status, no edits once billed.
  const order = await ordersService.createOrder({
    tenantId,
    actor: cashier,
    payload: {
      total: 1,
      outlet_id: outlet.id,
      items: [{ id: product.id, quantity: 3, price: 0.01 }],
      metadata: { kot: { number: 1 }, approval_status: "approved", notes: "no onions" },
    },
  });
  assert.equal(order.total, 300, "order total is derived from the catalogue");
  assert.equal(order.metadata?.kot, undefined, "system metadata cannot be forged");
  assert.equal(order.metadata?.approval_status, undefined);
  assert.equal(order.metadata?.notes, "no onions");
  assert.equal(await fails(ordersService.createOrder({ tenantId, actor: cashier, payload: { channel: "qr", items: [{ id: product.id, quantity: 1 }] } })), "400:ORDER_CHANNEL_RESERVED");
  assert.equal(await fails(ordersService.createOrder({ tenantId, actor: cashier, payload: { status: "billed", items: [{ id: product.id, quantity: 1 }] } })), "400:ORDER_STATUS_NOT_ALLOWED");
  assert.equal(await fails(ordersService.createOrder({ tenantId, actor: cashier, payload: { outlet_id: foreignOutlet.id, items: [{ id: product.id, quantity: 1 }] } })), "400:REFERENCE_NOT_IN_BUSINESS");
  const edited = await ordersService.updateOrder({ tenantId, actor: cashier, orderId: order.id, payload: { total: 1, items: [{ id: product.id, quantity: 1 }] } });
  assert.equal(edited.total, 100);
  assert.equal(edited.items.length, 1);

  const orderBill = await bill(cashier, { order_id: order.id });
  assert.equal(orderBill.subtotal, 100);
  assert.equal(await fails(bill(cashier, { order_id: order.id })), "409:ORDER_ALREADY_BILLED");
  assert.equal(await fails(ordersService.updateOrder({ tenantId, actor: cashier, orderId: order.id, payload: { status: "open" } })), "409:ORDER_NOT_EDITABLE");
  assert.equal(await fails(ordersService.deleteOrder({ tenantId, orderId: order.id })), "409:ORDER_HAS_BILL");
  assert.ok(await prisma.bill.findUnique({ where: { id: orderBill.id } }), "the bill still points at its order");

  // 8. Payments and refunds are retry-safe too.
  const due = await bill(manager, { payment_type: "Due", items: [{ id: product.id, quantity: 1 }] });
  const pay = () => mutateBillPayment({ tenantId, invoiceId: due.id, action: "payment", user: manager, payload: { amount: 40, method: "Cash", client_request_id: "pay-1" } });
  await Promise.all([pay(), pay()]);
  const afterPay = await prisma.bill.findUnique({ where: { id: due.id } });
  assert.equal(afterPay.metadata.payments.length, 1, "a retried payment is recorded once");
  assert.equal(afterPay.metadata.paid_amount, 40);
  const refund = () => mutateBillPayment({ tenantId, invoiceId: due.id, action: "refund", user: manager, payload: { amount: 10, reason: "test", client_request_id: "ref-1" } });
  await Promise.all([refund(), refund()]);
  const afterRefund = await prisma.bill.findUnique({ where: { id: due.id } });
  assert.equal(afterRefund.metadata.refunds.length, 1, "a retried refund is recorded once");
  assert.equal(afterRefund.metadata.refunded_amount, 10);

  // 9. Stock, invoice numbers and billed orders are protected by the database itself.
  const limited = await prisma.product.create({ data: { businessId, name: "Limited", price: 10, category: "Food", stock: 2 } });
  assert.equal(await fails(bill(cashier, { items: [{ id: limited.id, quantity: 3 }] })), "409:INSUFFICIENT_STOCK");
  assert.equal((await prisma.product.findUnique({ where: { id: limited.id } })).stock, 2, "a refused sale leaves stock untouched");
  await bill(cashier, { items: [{ id: limited.id, quantity: 2 }] });
  assert.equal((await prisma.product.findUnique({ where: { id: limited.id } })).stock, 0);

  const stored = await prisma.bill.findUnique({ where: { id: first.id } });
  assert.equal(stored.invoiceNumber, first.invoice_number, "the invoice number is a real column");
  assert.equal(typeof stored.total, "number", "exact DECIMAL money is returned to the app as a number");
  await assert.rejects(
    prisma.bill.create({ data: { businessId, customerName: "dup", currency: "INR", status: "issued", invoiceNumber: first.invoice_number } }),
    (error) => error.code === "P2002",
    "a duplicate invoice number is rejected by the database",
  );
  const exact = await prisma.product.create({ data: { businessId, name: "Penny", price: 0.1 + 0.2, category: "Food", stock: 10 } });
  assert.equal(exact.price, 0.3, "money is stored exactly to the cent");
  await assert.rejects(prisma.order.delete({ where: { id: order.id } }), "a billed order cannot be deleted even directly");
  const ticketOrder = await prisma.order.create({ data: { businessId, customerName: "k", channel: "pos", status: "accepted" } });
  await prisma.kitchenTicket.create({ data: { businessId, orderId: ticketOrder.id, status: "pending" } });
  await assert.rejects(prisma.kitchenTicket.create({ data: { businessId, orderId: ticketOrder.id, status: "pending" } }), (error) => error.code === "P2002");

  // 10. Payment intents are tied to the bill they collect for.
  const upiBill = await bill(cashier, { payment_type: "UPI", items: [{ id: product.id, quantity: 1 }] });
  assert.equal(upiBill.due_amount, 118);
  assert.equal(await fails(paymentsService.createIntent({ tenantId, businessId, user: cashier, payload: { method: "UPI", amount: 500, invoice_id: upiBill.id } })), "400:AMOUNT_EXCEEDS_DUE");
  const intent = await paymentsService.createIntent({ tenantId, businessId, user: cashier, payload: { method: "UPI", amount: 118, invoice_id: upiBill.id } });
  assert.ok(intent.bill_payment_id, "the intent points at the bill's pending UPI payment");
  const again = await paymentsService.createIntent({ tenantId, businessId, user: cashier, payload: { method: "UPI", amount: 118, invoice_id: upiBill.id } });
  assert.equal(again.id, intent.id, "one open intent per pending bill payment");
  assert.equal(await fails(paymentsService.confirmIntent({ tenantId, businessId, intentId: intent.id, user: cashier, payload: { reference: "UTR1" } })), "403:MANAGER_CONFIRMATION_REQUIRED");
  assert.equal(await fails(paymentsService.confirmIntent({ tenantId, businessId, intentId: intent.id, user: manager, payload: {} })), "400:REFERENCE_REQUIRED");
  const confirmedIntent = await paymentsService.confirmIntent({ tenantId, businessId, intentId: intent.id, user: manager, payload: { reference: "UTR1" } });
  assert.equal(confirmedIntent.status, "confirmed");
  const paidBill = await prisma.bill.findUnique({ where: { id: upiBill.id } });
  assert.equal(paidBill.metadata.payment_status, "paid", "confirming the intent pays the bill");
  assert.equal(paidBill.metadata.payments.length, 1, "no duplicate payment row");
  assert.equal(await fails(paymentsService.createIntent({ tenantId, businessId, user: cashier, payload: { method: "UPI", amount: 1, invoice_id: upiBill.id } })), "400:AMOUNT_EXCEEDS_DUE");

  // 11. A bill rung up offline keeps its original time and syncs only once.
  const offlineAt = new Date(Date.now() - 3600_000).toISOString();
  const offline = await bill(cashier, { client_request_id: "offline-1", offline_created_at: offlineAt, items: [{ id: product.id, quantity: 1, price: 1 }] });
  assert.equal(offline.offline_created_at, offlineAt);
  assert.equal(offline.total, 118, "offline bills are re-priced by the server");
  assert.equal((await bill(cashier, { client_request_id: "offline-1", offline_created_at: offlineAt, items: [{ id: product.id, quantity: 1 }] })).id, offline.id);
  const future = await bill(cashier, { offline_created_at: new Date(Date.now() + 86400_000).toISOString(), items: [{ id: product.id, quantity: 1 }] });
  assert.equal(future.offline_created_at ?? null, null, "an implausible offline time is ignored");

  console.log("Billing and order integrity: trusted pricing, forged metadata, discounts, idempotency, lifecycle passed");
} finally {
  await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `payment-intent:${encodeURIComponent(businessId)}:` } } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.$disconnect();
}
