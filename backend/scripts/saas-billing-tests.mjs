import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";

// A stand-in for AdminCore's billing API: records every call and answers like AdminCore does.
const calls = [];
let checkoutReply = { status: 200, body: { short_url: "https://rzp.io/i/sub_1", razorpay_subscription_id: "sub_1", reused: false } };
const admincore = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    calls.push({ method: req.method, url: req.url, key: req.headers["x-admincore-api-key"], body: raw ? JSON.parse(raw) : null });
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url.startsWith("/api/billing/pos/") && req.method === "GET") return send(200, { status: "trial", plans: [{ slug: "pro", pricing: { monthly: 2499 } }], payments: [], configured: true });
    if (req.url.endsWith("/checkout")) return send(checkoutReply.status, checkoutReply.body);
    if (req.url.endsWith("/cancel")) return send(409, { detail: { code: "NOTHING_TO_CANCEL", message: "There is no automatic payment to cancel" } });
    return send(200, {});
  });
});
await new Promise((resolve) => admincore.listen(0, "127.0.0.1", resolve));
const KEY = `bridge-key-${randomUUID()}`;
Object.assign(process.env, { ADMINCORE_ENABLED: "true", ADMINCORE_API_BASE_URL: `http://127.0.0.1:${admincore.address().port}`, ADMINCORE_API_KEY: KEY });

const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/database/prisma/client.js");
const { connectDatabase } = await import("../src/config/db.js");
const { usersService } = await import("../src/core/users/users.service.js");
const { saasService } = await import("../src/core/saas/saas.service.js");
const { stopRealtime } = await import("../src/services/realtime/realtime.service.js");

const suffix = randomUUID().slice(0, 8);
const biz = `saas-bill-${suffix}`;
const tenant = `tenant-${biz}`;
const server = http.createServer(app);
const password = `Pw-${randomUUID()}`;
const call = async (method, path, { session, body, headers = {} } = {}) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, text, data: json?.data ?? json, code: json?.error?.code || null };
};
const ok = async (promise, status, label) => {
  const result = await promise;
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status} ${result.text.slice(0, 200)}`);
  return result;
};

try {
  await connectDatabase();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await prisma.business.create({ data: { id: biz, tenantId: tenant, name: "Billing Cafe" } });
  const owner = await usersService.createUser({ businessId: biz, tenantId: tenant, payload: { email: `o-${suffix}@t.test`, password, role: "Owner", name: "Olu", profile_required: false } });
  await usersService.createUser({ businessId: biz, tenantId: tenant, payload: { email: `m-${suffix}@t.test`, password, role: "Manager", name: "Mo", profile_required: false } });
  const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password } })).data?.session_id;
  const ownerS = await login(owner.email);
  const managerS = await login(`m-${suffix}@t.test`);

  await ok(call("GET", "/api/saas/billing/status", { session: managerS }), 403, "billing is the Owner's");
  const status = await ok(call("GET", "/api/saas/billing/status", { session: ownerS }), 200, "status");
  assert.equal(status.data.plans[0].slug, "pro");
  const statusCall = calls.at(-1);
  assert.equal(statusCall.url, `/api/billing/pos/${biz}?tenant_id=${encodeURIComponent(tenant)}`, "always this business and tenant");
  assert.equal(statusCall.key, KEY);

  await ok(call("POST", "/api/saas/billing/checkout", { session: ownerS, body: { plan_slug: "Pro!!" } }), 400, "plan checked");
  const checkout = await ok(call("POST", "/api/saas/billing/checkout", { session: ownerS, body: { plan_slug: "pro", billing_cycle: "yearly", business_id: "someone-else", tenant_id: "other" } }), 200, "checkout");
  assert.equal(checkout.data.short_url, "https://rzp.io/i/sub_1");
  const sent = calls.at(-1);
  assert.equal(sent.url, `/api/billing/pos/${biz}/checkout`, "a business id in the request body is ignored");
  assert.equal(sent.body.tenant_id, tenant);
  assert.equal(sent.body.billing_cycle, "yearly");
  assert.equal(sent.body.actor_id, owner.id);
  const cancel = await call("POST", "/api/saas/billing/cancel", { session: ownerS });
  assert.equal(cancel.status, 409);
  assert.equal(cancel.code, "NOTHING_TO_CANCEL", "AdminCore's reason reaches the owner");

  // Expired: read-only everywhere, except paying.
  await saasService.updateSubscription({ businessId: biz, payload: { subscription_status: "expired" } });
  await ok(call("POST", "/api/staff", { session: ownerS, body: { email: `x-${suffix}@t.test`, password, role: "Waiter", name: "X" } }), 402, "an expired business is read-only");
  await ok(call("POST", "/api/saas/billing/checkout", { session: ownerS, body: { plan_slug: "pro" } }), 200, "but can still pay");
  checkoutReply = { status: 502, body: { detail: "upstream" } };
  await ok(call("POST", "/api/saas/billing/checkout", { session: ownerS, body: { plan_slug: "pro" } }), 502, "AdminCore failure");
  // Suspended by Taskoora: fully blocked, billing too.
  await saasService.updateSubscription({ businessId: biz, payload: { subscription_status: "suspended" } });
  await ok(call("GET", "/api/saas/billing/status", { session: ownerS }), 403, "a suspended business is blocked");

  // AdminCore pushes the paid plan: limits and features follow it.
  await ok(call("PUT", `/api/admincore/tenants/${biz}/subscription`, { body: { subscription_status: "active", plan: "growth", current_period_end: "2026-11-01T00:00:00.000Z" }, headers: { "x-admincore-api-key": KEY } }), 200, "paid plan pushed");
  const overview = await saasService.getTenantOverview({ businessId: biz });
  assert.equal(overview.plan.key, "growth");
  assert.equal(overview.plan.limits.outlets, 3);
  assert.ok(overview.enabled_features.includes("inventory"), "the paid plan's features are switched on");
  assert.equal(overview.subscription.status, "active");
  await ok(call("PUT", `/api/admincore/tenants/${biz}/subscription`, { body: { subscription_status: "active", plan: "enterprise" }, headers: { "x-admincore-api-key": "wrong" } }), 401, "only AdminCore can push");

  console.log("SaaS billing bridge passed: Owner-only, scoped to the business and tenant, AdminCore errors passed through, expired businesses can pay, suspended ones cannot, paid plans apply limits and features");
} finally {
  await prisma.business.deleteMany({ where: { id: biz } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: biz } } }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => admincore.close(resolve));
  await stopRealtime();
  await prisma.$disconnect();
}
process.exit(0);
