import assert from "node:assert/strict";
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { setRazorpayFetch } from "../src/core/payments/razorpay.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

// ---------------------------------------------------------------- a small in-memory Razorpay
const KEY_ID = "rzp_test_ABCdef123456";
const KEY_SECRET = `secret-${randomUUID()}`;
const rz = { qrs: new Map(), links: new Map(), payments: new Map(), refunds: new Map(), calls: [], failRefunds: false };
const nextId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
setRazorpayFetch(async (url, options) => {
  const path = url.replace("https://api.razorpay.com/v1", "");
  const body = options.body ? JSON.parse(options.body) : null;
  rz.calls.push({ method: options.method, path, body });
  if (options.headers.authorization !== `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`) {
    return reply(401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });
  }
  let match;
  if (options.method === "GET" && path.startsWith("/payments?")) return reply(200, { items: [] });
  if (options.method === "POST" && path === "/payments/qr_codes") {
    const qr = { id: nextId("qr"), status: "active", image_url: "https://rzp.io/qr.png", ...body };
    rz.qrs.set(qr.id, qr);
    return reply(200, qr);
  }
  if ((match = path.match(/^\/payments\/qr_codes\/([^/]+)\/close$/))) { rz.qrs.get(match[1]).status = "closed"; return reply(200, rz.qrs.get(match[1])); }
  if ((match = path.match(/^\/payments\/qr_codes\/([^/]+)\/payments$/))) {
    return reply(200, { items: [...rz.payments.values()].filter((payment) => payment.qr_id === match[1]) });
  }
  if (options.method === "POST" && path === "/payment_links") {
    const link = { id: nextId("plink"), status: "created", short_url: "https://rzp.io/i/abc", payments: [], ...body };
    rz.links.set(link.id, link);
    return reply(200, link);
  }
  if ((match = path.match(/^\/payment_links\/([^/]+)\/cancel$/))) {
    const link = rz.links.get(match[1]);
    if (link.status === "paid") return reply(400, { error: { description: "Payment link cannot be cancelled" } });
    link.status = "cancelled";
    return reply(200, link);
  }
  if ((match = path.match(/^\/payment_links\/([^/]+)$/))) return reply(200, rz.links.get(match[1]));
  if ((match = path.match(/^\/payments\/([^/]+)\/capture$/))) {
    const payment = rz.payments.get(match[1]);
    assert.equal(body.amount, payment.amount, "capture exactly what was authorised");
    payment.status = "captured";
    return reply(200, payment);
  }
  if ((match = path.match(/^\/payments\/([^/]+)\/refunds\?count=100$/))) {
    return reply(200, { items: [...rz.refunds.values()].filter((refund) => refund.payment_id === match[1]) });
  }
  if ((match = path.match(/^\/payments\/([^/]+)\/refund$/))) {
    if (rz.failRefunds) return reply(500, { error: { description: "Temporary failure" } });
    const payment = rz.payments.get(match[1]);
    const done = [...rz.refunds.values()].filter((refund) => refund.payment_id === payment.id).reduce((sum, refund) => sum + refund.amount, 0);
    if (done + body.amount > payment.amount) return reply(400, { error: { description: "The total refund amount is greater than the refund payment amount" } });
    const refund = { id: nextId("rfnd"), payment_id: payment.id, amount: body.amount, status: "processed", notes: body.notes || {}, receipt: body.receipt };
    rz.refunds.set(refund.id, refund);
    return reply(200, refund);
  }
  if ((match = path.match(/^\/payments\/([^/]+)$/))) return reply(200, rz.payments.get(match[1]));
  return reply(404, { error: { description: `unknown ${options.method} ${path}` } });
});
/** The customer pays: a captured (or only authorised) payment attached to a QR code or link. */
const customerPays = ({ qrId, linkId, amount, status = "captured", method = "upi" }) => {
  const payment = { id: nextId("pay"), entity: "payment", amount, currency: "INR", status, method, notes: {}, qr_id: qrId || null };
  rz.payments.set(payment.id, payment);
  if (linkId) {
    const link = rz.links.get(linkId);
    link.status = "paid";
    link.payments.push({ payment_id: payment.id });
  }
  return payment;
};

// ---------------------------------------------------------------- app harness
const suffix = randomUUID().slice(0, 8);
const bizA = `rzp-a-${suffix}`;
const bizB = `rzp-b-${suffix}`;
const scope = (id) => ({ businessId: id, tenantId: `tenant-${id}` });
const server = http.createServer(app);
const password = `Pw-${randomUUID()}`;
const call = async (method, path, { session, body, raw, headers = {} } = {}) => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, text, json, data: json?.data ?? json, code: json?.error?.code || null };
};
const ok = async (promise, status, label) => {
  const result = await promise;
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status} ${result.text.slice(0, 240)}`);
  return result;
};
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password } })).data?.session_id;
const fails = async (promise) => { try { await promise; return null; } catch (error) { return error.code || String(error.statusCode); } };

try {
  await connectDatabase();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  for (const id of [bizA, bizB]) {
    await prisma.business.create({ data: { id, tenantId: `tenant-${id}`, name: `Cafe ${id}` } });
    await saasService.updateSubscription({ businessId: id, payload: { plan: "growth", subscription_status: "active" } });
  }
  const product = await prisma.product.create({ data: { businessId: bizA, name: "Dosa", price: 100, category: "Food", stock: 10000 } });
  const make = (role, name, business = bizA) => usersService.createUser({ ...scope(business), payload: { email: `${name}-${suffix}@t.test`, password, role, name, profile_required: false } });
  const owner = await make("Owner", "owner");
  const manager = await make("Manager", "manager");
  const cashier = await make("Cashier", "cashier");
  const ownerB = await make("Owner", "ownerb", bizB);
  const [ownerS, managerS, cashierS, ownerBS] = await Promise.all([owner, manager, cashier, ownerB].map((user) => login(user.email)));
  const actor = (user) => ({ id: user.id, name: user.name, role: user.role });

  // ---------------------------------------------------------------- connecting the account
  assert.equal((await ok(call("GET", "/api/payments/gateway/status", { session: cashierS }), 200, "status")).data.enabled, false);
  await ok(call("PUT", "/api/payments/gateway", { session: managerS, body: { key_id: KEY_ID } }), 403, "only the Owner connects Razorpay");
  await ok(call("PUT", "/api/payments/gateway", { session: ownerS, body: { key_id: "not-a-key" } }), 400, "key format checked");
  await ok(call("PUT", "/api/payments/gateway", { session: ownerS, body: { key_id: KEY_ID, key_secret: KEY_SECRET, enabled: true } }), 400, "no webhook secret yet");
  const secret = await ok(call("POST", "/api/payments/gateway/webhook-secret", { session: ownerS }), 200, "webhook secret");
  const webhookSecret = secret.data.webhook_secret;
  assert.ok(webhookSecret.length >= 30);
  await ok(call("PUT", "/api/payments/gateway", { session: ownerS, body: { key_id: KEY_ID, key_secret: "wrong-secret", enabled: true } }), 400, "keys Razorpay rejects cannot be switched on");
  const saved = await ok(call("PUT", "/api/payments/gateway", { session: ownerS, body: { key_id: KEY_ID, key_secret: KEY_SECRET, enabled: true } }), 200, "connect");
  assert.equal(saved.data.mode, "test");
  assert.ok(!saved.text.includes(KEY_SECRET) && !saved.text.includes(webhookSecret), "secrets are never sent back");
  const stored = await prisma.paymentGatewayConfig.findUnique({ where: { businessId: bizA } });
  assert.ok(!stored.keySecretEnc.includes(KEY_SECRET) && !stored.webhookSecretEnc.includes(webhookSecret), "stored encrypted");
  const hookPath = `/api/public/payments/razorpay/webhook/${stored.webhookKey}`;
  let eventCounter = 0;
  const deliver = (event, payload, { secretOverride, eventId } = {}) => {
    const raw = JSON.stringify({ entity: "event", event, payload, created_at: Math.floor(Date.now() / 1000) });
    const signature = createHmac("sha256", secretOverride || webhookSecret).update(raw).digest("hex");
    return call("POST", hookPath, { raw, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId || `evt_${suffix}_${eventCounter += 1}` } });
  };

  // ---------------------------------------------------------------- UPI QR at the till, confirmed by webhook
  const upiBill = await billingService.createInvoice({ ...scope(bizA), user: actor(cashier), payload: { payment_type: "UPI", items: [{ id: product.id, quantity: 1 }] } });
  assert.equal(upiBill.total, 118);
  const intent = await ok(call("POST", "/api/payments/intents", { session: cashierS, body: { provider: "razorpay", method: "UPI", amount: 118, invoice_id: upiBill.id } }), 201, "QR request");
  assert.ok(intent.data.razorpay.image_url);
  const qrCall = rz.calls.find((row) => row.path === "/payments/qr_codes");
  assert.equal(qrCall.body.payment_amount, 11800, "amounts go to Razorpay in paise");
  assert.equal(qrCall.body.fixed_amount, true);
  assert.equal(qrCall.body.usage, "single_use");
  assert.equal(qrCall.body.notes.intent_id, intent.data.id);
  const qrId = [...rz.qrs.keys()].at(-1);
  const pendingRow = (await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: upiBill.id })).payments[0];
  assert.equal(pendingRow.gateway_intent_id, intent.data.id);
  assert.equal(await fails(billingService.confirmPayment({ ...scope(bizA), invoiceId: upiBill.id, paymentId: pendingRow.id, user: actor(manager), payload: { reference: "UTR-FAKE" } })), "GATEWAY_PAYMENT_PENDING", "no confirming by hand while Razorpay collects it");
  await ok(call("POST", `/api/payments/intents/${intent.data.id}/confirm`, { session: managerS, body: { reference: "x" } }), 409, "only Razorpay confirms its requests");

  const paid = customerPays({ qrId, amount: 11800 });
  const qrEntity = rz.qrs.get(qrId);
  await ok(deliver("qr_code.credited", { payment: { entity: paid }, qr_code: { entity: qrEntity } }, { secretOverride: "forged" }), 401, "forged webhook");
  await ok(deliver("qr_code.credited", { payment: { entity: paid }, qr_code: { entity: qrEntity } }, { eventId: `evt_dup_${suffix}` }), 200, "webhook");
  let bill = await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: upiBill.id });
  assert.equal(bill.payment_status, "paid");
  assert.equal(bill.payments.length, 1, "the waiting payment itself is confirmed");
  assert.equal(bill.payments[0].gateway_payment_id, paid.id);
  assert.equal(bill.payments[0].reference, paid.id);
  await ok(deliver("qr_code.credited", { payment: { entity: paid }, qr_code: { entity: qrEntity } }, { eventId: `evt_dup_${suffix}` }), 200, "redelivered");
  await ok(deliver("payment.captured", { payment: { entity: { ...paid, notes: { intent_id: intent.data.id } } } }), 200, "second event for the same payment");
  bill = await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: upiBill.id });
  assert.equal(bill.payments.length, 1, "one Razorpay payment is recorded once");
  assert.ok(![...rz.refunds.values()].some((refund) => refund.payment_id === paid.id), "a recorded payment is never refunded because Razorpay reported it again");
  assert.equal(bill.paid_amount, 118);
  assert.equal((await ok(call("GET", `/api/payments/intents/${intent.data.id}`, { session: cashierS }), 200, "intent")).data.status, "confirmed");
  const drawer = await billingService.getCashDrawerReport(scope(bizA));
  assert.ok(drawer.non_cash_sales >= 118, "gateway money counts as non-cash sales");

  // ---------------------------------------------------------------- polling (no webhook), and payments needing capture
  const bill2 = await billingService.createInvoice({ ...scope(bizA), user: actor(cashier), payload: { payment_type: "UPI", items: [{ id: product.id, quantity: 2 }] } });
  const intent2 = await ok(call("POST", "/api/payments/intents", { session: cashierS, body: { provider: "razorpay", method: "UPI", amount: bill2.total, invoice_id: bill2.id } }), 201, "QR 2");
  assert.equal((await ok(call("POST", `/api/payments/intents/${intent2.data.id}/refresh`, { session: cashierS }), 200, "poll unpaid")).data.status, "pending");
  customerPays({ qrId: [...rz.qrs.keys()].at(-1), amount: 23600, status: "authorized", method: "card" });
  const polled = await ok(call("POST", `/api/payments/intents/${intent2.data.id}/refresh`, { session: cashierS }), 200, "poll paid");
  assert.equal(polled.data.status, "confirmed", "the till sees the payment even without webhooks");
  assert.ok(rz.calls.some((row) => row.path.endsWith("/capture")), "an authorised-only payment is captured");
  assert.equal((await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: bill2.id })).payments[0].method, "Card");

  // ---------------------------------------------------------------- wrong amount, cancelled requests, bills paid another way
  const bill3 = await billingService.createInvoice({ ...scope(bizA), user: actor(cashier), payload: { payment_type: "UPI", items: [{ id: product.id, quantity: 1 }] } });
  const intent3 = await ok(call("POST", "/api/payments/intents", { session: cashierS, body: { provider: "razorpay", method: "UPI", amount: 118, invoice_id: bill3.id } }), 201, "QR 3");
  const qr3 = [...rz.qrs.keys()].at(-1);
  const wrong = customerPays({ qrId: qr3, amount: 5000 });
  await ok(deliver("qr_code.credited", { payment: { entity: wrong }, qr_code: { entity: rz.qrs.get(qr3) } }), 200, "wrong amount");
  assert.equal((await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: bill3.id })).payment_status, "unpaid", "a wrong amount is never booked");
  assert.ok([...rz.refunds.values()].some((refund) => refund.payment_id === wrong.id && refund.amount === 5000), "and is given back");
  const cancelled = await ok(call("POST", `/api/payments/intents/${intent3.data.id}/cancel`, { session: cashierS }), 200, "cancel");
  assert.equal(cancelled.data.status, "cancelled");
  assert.equal(rz.qrs.get(qr3).status, "closed", "the QR stops accepting money");
  const late = customerPays({ qrId: qr3, amount: 11800 });
  await ok(deliver("qr_code.credited", { payment: { entity: late }, qr_code: { entity: rz.qrs.get(qr3) } }), 200, "late payment");
  assert.ok([...rz.refunds.values()].some((refund) => refund.payment_id === late.id), "money for a cancelled request is refunded");
  await billingService.confirmPayment({ ...scope(bizA), invoiceId: bill3.id, paymentId: (await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: bill3.id })).payments[0].id, user: actor(manager), payload: { reference: "UTR-REAL-1" } });

  const dueBill = await billingService.createInvoice({ ...scope(bizA), user: actor(cashier), payload: { payment_type: "Due", customer_phone: "9876500000", items: [{ id: product.id, quantity: 1 }] } });
  const link = await ok(call("POST", "/api/payments/intents", { session: cashierS, body: { provider: "razorpay", razorpay_mode: "link", method: "UPI", amount: 118, invoice_id: dueBill.id, customer_phone: "9876500000" } }), 201, "payment link");
  assert.equal(link.data.razorpay.short_url, "https://rzp.io/i/abc");
  const linkCall = rz.calls.filter((row) => row.path === "/payment_links").at(-1);
  assert.equal(linkCall.body.customer.contact, "9876500000");
  assert.equal(linkCall.body.notify.sms, true);
  assert.equal(linkCall.body.accept_partial, false);
  await billingService.addPayment({ ...scope(bizA), invoiceId: dueBill.id, user: actor(cashier), payload: { amount: 118, method: "Cash" } });
  const linkId = [...rz.links.keys()].at(-1);
  const double = customerPays({ linkId, amount: 11800 });
  await ok(deliver("payment_link.paid", { payment: { entity: double }, payment_link: { entity: rz.links.get(linkId) } }), 200, "paid twice");
  const afterDouble = await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: dueBill.id });
  assert.equal(afterDouble.paid_amount, 118, "the bill is not paid twice");
  assert.ok([...rz.refunds.values()].some((refund) => refund.payment_id === double.id), "the second payment goes back to the customer");

  // Link paid normally.
  const bill5 = await billingService.createInvoice({ ...scope(bizA), user: actor(cashier), payload: { payment_type: "Due", items: [{ id: product.id, quantity: 1 }] } });
  const link5 = await ok(call("POST", "/api/payments/intents", { session: cashierS, body: { provider: "razorpay", razorpay_mode: "link", method: "UPI", amount: 118, invoice_id: bill5.id } }), 201, "link 5");
  const link5Id = [...rz.links.keys()].at(-1);
  const linkPaid = customerPays({ linkId: link5Id, amount: 11800 });
  await ok(deliver("payment_link.paid", { payment: { entity: linkPaid }, payment_link: { entity: rz.links.get(link5Id) } }), 200, "link paid");
  assert.equal((await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: bill5.id })).payment_status, "paid");
  assert.equal((await ok(call("GET", `/api/payments/intents/${link5.data.id}`, { session: cashierS }), 200, "link intent")).data.status, "confirmed");

  // ---------------------------------------------------------------- another business cannot confirm our requests
  const configB = await prisma.paymentGatewayConfig.upsert({ where: { businessId: bizB }, update: {}, create: { businessId: bizB, webhookKey: `wk-${suffix}` } });
  const bill6 = await billingService.createInvoice({ ...scope(bizA), user: actor(cashier), payload: { payment_type: "UPI", items: [{ id: product.id, quantity: 1 }] } });
  const intent6 = await ok(call("POST", "/api/payments/intents", { session: cashierS, body: { provider: "razorpay", method: "UPI", amount: 118, invoice_id: bill6.id } }), 201, "QR 6");
  const secretB = (await ok(call("POST", "/api/payments/gateway/webhook-secret", { session: ownerBS }), 200, "B secret")).data.webhook_secret;
  const qr6 = rz.qrs.get([...rz.qrs.keys()].at(-1));
  const foreign = customerPays({ qrId: qr6.id, amount: 11800 });
  const rawB = JSON.stringify({ event: "qr_code.credited", payload: { payment: { entity: foreign }, qr_code: { entity: qr6 } } });
  const sigB = createHmac("sha256", secretB).update(rawB).digest("hex");
  await ok(call("POST", `/api/public/payments/razorpay/webhook/${configB.webhookKey}`, { raw: rawB, headers: { "x-razorpay-signature": sigB, "x-razorpay-event-id": `evt_b_${suffix}` } }), 200, "B webhook");
  assert.equal((await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: bill6.id })).payment_status, "unpaid", "a payment reported by another business's account never pays our bill");
  await ok(call("GET", `/api/payments/intents/${intent6.data.id}`, { session: ownerBS }), 404, "and B cannot see our request");

  // ---------------------------------------------------------------- refunds through Razorpay
  const refundCalls = () => rz.calls.filter((row) => row.path.endsWith("/refund")).length;
  assert.equal(await fails(billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(manager), payload: { amount: 10, method: "UPI", reason: "x" } })), "USE_GATEWAY_REFUND", "a UPI refund cannot be recorded without moving money");
  assert.equal(await fails(billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(cashier), payload: { amount: 10, method: "Razorpay", reason: "x" } })), "MANAGER_REQUIRED");
  assert.equal(await fails(billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(manager), payload: { amount: 500, method: "Razorpay", reason: "x" } })), "REFUND_TOO_LARGE");
  const before = refundCalls();
  const refundKey = `refund-${suffix}`;
  const refunded = await billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(manager), payload: { amount: 50, method: "Razorpay", reason: "cold food", client_request_id: refundKey } });
  assert.equal(refundCalls(), before + 1);
  const sentRefund = rz.calls.filter((row) => row.path.endsWith("/refund")).at(-1);
  assert.equal(sentRefund.body.amount, 5000);
  assert.equal(sentRefund.path, `/payments/${paid.id}/refund`, "refunded to the payment that paid the bill");
  assert.equal(refunded.refunded_amount, 50);
  assert.equal(refunded.refunds[0].gateway_refunds[0].amount, 50);
  const again = await billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(manager), payload: { amount: 50, method: "Razorpay", reason: "cold food", client_request_id: refundKey } });
  assert.equal(refundCalls(), before + 1, "a retried refund is not sent to Razorpay again");
  assert.equal(again.refunded_amount, 50);
  // A refund Razorpay made whose recording was lost (crash) is found again by its key, not repeated.
  const lostKey = `lost-${suffix}`;
  rz.refunds.set("rfnd_lost", { id: "rfnd_lost", payment_id: paid.id, amount: 1000, status: "processed", notes: { pos_refund_key: `${lostKey}:${paid.id}` } });
  const recovered = await billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(manager), payload: { amount: 10, method: "Razorpay", reason: "retry", client_request_id: lostKey } });
  assert.equal(refundCalls(), before + 1, "the earlier Razorpay refund is reused");
  assert.equal(recovered.refunded_amount, 60);
  rz.failRefunds = true;
  assert.equal(await fails(billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(manager), payload: { amount: 10, method: "Razorpay", reason: "x", client_request_id: `fail-${suffix}` } })), "GATEWAY_REFUND_FAILED");
  assert.equal((await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: upiBill.id })).refunded_amount, 60, "a refund Razorpay refused is not recorded");
  rz.failRefunds = false;
  await ok(deliver("refund.failed", { refund: { entity: { id: refunded.refunds[0].gateway_refunds[0].refund_id, status: "failed", notes: { bill_id: upiBill.id } } } }), 200, "refund failed later");
  const flagged = await billingService.getInvoiceById({ tenantId: `tenant-${bizA}`, invoiceId: upiBill.id });
  assert.equal(flagged.gateway_refund_failed, true, "a failed Razorpay refund is flagged for a manager");
  assert.equal(flagged.refunds[0].gateway_refunds[0].status, "failed");
  await billingService.refundInvoice({ ...scope(bizA), invoiceId: upiBill.id, user: actor(manager), payload: { amount: 5, method: "Cash", reason: "cash handed back" } });

  // Switching off stops new requests.
  await ok(call("PUT", "/api/payments/gateway", { session: ownerS, body: { enabled: false } }), 200, "switch off");
  const offBill = await billingService.createInvoice({ ...scope(bizA), user: actor(cashier), payload: { payment_type: "UPI", items: [{ id: product.id, quantity: 1 }] } });
  assert.equal((await call("POST", "/api/payments/intents", { session: cashierS, body: { provider: "razorpay", method: "UPI", amount: 118, invoice_id: offBill.id } })).code, "GATEWAY_NOT_ENABLED");

  console.log("Razorpay payments passed: encrypted keys, QR and payment links in paise, signed webhooks, one record per payment, polling, capture, wrong/late/duplicate payments refunded, tenant isolation, refunds sent once and recorded after Razorpay accepts them, failed refunds flagged");
} finally {
  setRazorpayFetch(null);
  await prisma.business.deleteMany({ where: { id: { in: [bizA, bizB] } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: suffix } } }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await stopRealtime();
  await prisma.$disconnect();
}
