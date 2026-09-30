import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { publishChange, stopRealtime } from "../src/services/realtime/realtime.service.js";

// Minimal SSE reader: resolves with parsed "change" events seen during `ms`.
const collectEvents = async (url, ms) => {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const events = [];
  if (response.status !== 200) return { status: response.status, events };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (/^event: change$/m.test(block)) events.push(JSON.parse(block.match(/^data: (.*)$/m)[1]));
      }
    }
  } catch { /* aborted at the end of the window */ } finally { clearTimeout(timer); }
  return { status: 200, events };
};

const suffix = randomUUID().slice(0, 8);
const bizA = `acl-a-${suffix}`;
const bizB = `acl-b-${suffix}`;
const scope = (id) => ({ businessId: id, tenantId: `tenant-${id}` });
const server = http.createServer(app);

const call = async (method, path, { session, body } = {}) => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, data: json?.data ?? json };
};
const login = async (email, password, businessId) => {
  const result = await call("POST", "/api/auth/login", { body: { email, password, ...(businessId ? { business_id: businessId } : {}) } });
  return { ...result, session: result.data?.session_id };
};

try {
  await connectDatabase();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await prisma.business.create({ data: { id: bizA, tenantId: `tenant-${bizA}`, name: "ACL Cafe A" } });
  await prisma.business.create({ data: { id: bizB, tenantId: `tenant-${bizB}`, name: "ACL Cafe B" } });
  const outlet1 = await prisma.outlet.create({ data: { businessId: bizA, name: "Downtown", code: `D${suffix}` } });
  const outlet2 = await prisma.outlet.create({ data: { businessId: bizA, name: "Airport", code: `A${suffix}` } });
  const product = await prisma.product.create({ data: { businessId: bizA, name: "Tea", price: 50, category: "Drinks", stock: 1000 } });

  const password = `Pw-${randomUUID()}`;
  await usersService.createUser({ ...scope(bizA), payload: { email: `owner-${suffix}@t.test`, password, role: "Owner", name: "Owner", profile_required: false } });
  const cashier = await usersService.createUser({ ...scope(bizA), payload: {
    email: `cash-${suffix}@t.test`, password, role: "Cashier", name: "Cashier", assigned_outlet_ids: [outlet1.id], profile_required: false } });
  assert.deepEqual(cashier.assigned_outlet_ids, [outlet1.id]);

  const owner = await login(`owner-${suffix}@t.test`, password);
  const cash = await login(`cash-${suffix}@t.test`, password);
  assert.equal(owner.status, 200);
  assert.equal(cash.status, 200);

  // ---- outlet scope
  const outletList = await call("GET", "/api/outlets", { session: cash.session });
  const outletIds = (Array.isArray(outletList.data) ? outletList.data : outletList.data?.items || []).map((row) => row.id);
  assert.ok(outletIds.includes(outlet1.id) && !outletIds.includes(outlet2.id), "a cashier sees only assigned outlets");
  assert.equal((await call("GET", `/api/outlets/${outlet2.id}`, { session: cash.session })).status, 403);
  assert.equal((await call("GET", `/api/outlets/${outlet1.id}`, { session: cash.session })).status, 200);
  const ownerOutlets = await call("GET", "/api/outlets", { session: owner.session });
  assert.ok((Array.isArray(ownerOutlets.data) ? ownerOutlets.data : ownerOutlets.data?.items || []).some((row) => row.id === outlet2.id), "owners see every outlet");

  const item = [{ id: product.id, quantity: 1 }];
  assert.equal((await call("POST", "/api/billing", { session: cash.session, body: { outlet_id: outlet2.id, items: item, payment_type: "Cash" } })).status, 403);
  const cashierBill = await call("POST", "/api/billing", { session: cash.session, body: { items: item, payment_type: "Cash" } });
  assert.equal(cashierBill.status, 201, JSON.stringify(cashierBill.json));
  assert.equal(cashierBill.data.outlet_id, outlet1.id, "a single-outlet cashier's sale is filed under that outlet");
  const otherBill = await call("POST", "/api/billing", { session: owner.session, body: { outlet_id: outlet2.id, items: item, payment_type: "Cash" } });
  assert.equal(otherBill.status, 201);

  const cashierBills = await call("GET", "/api/billing", { session: cash.session });
  const billIds = cashierBills.data.map((bill) => bill.id);
  assert.ok(billIds.includes(cashierBill.data.id) && !billIds.includes(otherBill.data.id), "bill lists are outlet-scoped");
  assert.equal((await call("GET", `/api/billing/${otherBill.data.id}`, { session: cash.session })).status, 403);
  assert.equal((await call("GET", `/api/bills/${otherBill.data.id}`, { session: cash.session })).status, 403);
  const legacyBills = await call("GET", "/api/bills", { session: cash.session });
  assert.ok(!legacyBills.data.some((bill) => bill.id === otherBill.data.id));
  assert.equal((await call("GET", `/api/billing/${otherBill.data.id}`, { session: owner.session })).status, 200);

  // ---- unguarded reads are now guarded (a Chef holds no permissions)
  await usersService.createUser({ ...scope(bizA), payload: { email: `chef-${suffix}@t.test`, password, role: "Chef", name: "Chef", profile_required: false } });
  const chef = await login(`chef-${suffix}@t.test`, password);
  for (const path of ["/api/bills", "/api/customer-analytics", "/api/table-reservations", "/api/tables", "/api/central-kitchen"]) {
    assert.equal((await call("GET", path, { session: chef.session })).status, 403, path);
  }

  // ---- the same email in two businesses
  await usersService.createUser({ ...scope(bizB), payload: { email: `owner-${suffix}@t.test`, password, role: "Owner", name: "Owner B", profile_required: false } });
  const ambiguous = await login(`owner-${suffix}@t.test`, password);
  assert.equal(ambiguous.status, 409);
  assert.equal(ambiguous.json.error.code, "LOGIN_BUSINESS_REQUIRED");
  assert.deepEqual(ambiguous.json.error.details.businesses.map((row) => row.id).sort(), [bizA, bizB].sort());
  const intoB = await login(`owner-${suffix}@t.test`, password, bizB);
  assert.equal(intoB.status, 200);
  assert.equal(intoB.data.user.business_id, bizB);
  // A different password for the same email reaches only the account it belongs to.
  const otherPassword = `Pw-${randomUUID()}`;
  await usersService.createUser({ ...scope(bizB), payload: { email: `solo-${suffix}@t.test`, password: otherPassword, role: "Cashier", name: "Solo B", profile_required: false } });
  await usersService.createUser({ ...scope(bizA), payload: { email: `solo-${suffix}@t.test`, password, role: "Cashier", name: "Solo A", profile_required: false } });
  const soloA = await login(`solo-${suffix}@t.test`, password);
  assert.equal(soloA.status, 200);
  assert.equal(soloA.data.user.business_id, bizA);

  // ---- changing your own password needs the current one
  assert.equal((await call("POST", "/api/auth/change-password", { session: cash.session, body: { current_password: "wrong", new_password: "brand-new-pass-1" } })).status, 400);
  const secondDevice = await login(`cash-${suffix}@t.test`, password);
  const changed = await call("POST", "/api/auth/change-password", { session: cash.session, body: { current_password: password, new_password: "brand-new-pass-1" } });
  assert.equal(changed.status, 200);
  assert.equal((await call("GET", "/api/outlets", { session: cash.session })).status, 200, "the device that changed the password stays signed in");
  assert.equal((await call("GET", "/api/outlets", { session: secondDevice.session })).status, 401, "other devices are signed out");
  assert.equal((await login(`cash-${suffix}@t.test`, password)).status, 401);
  assert.equal((await login(`cash-${suffix}@t.test`, "brand-new-pass-1")).status, 200);
  // The profile endpoint can no longer be used to set a password without the current one.
  const profile = await call("PUT", "/api/staff/me/profile", { session: cash.session, body: { name: "Renamed", password: "sneaky-pass-99" } });
  assert.equal(profile.status, 200, JSON.stringify(profile.json));
  assert.equal(profile.data.name, "Renamed");
  assert.equal((await login(`cash-${suffix}@t.test`, "sneaky-pass-99")).status, 401);

  // ---- live updates
  const base = `http://127.0.0.1:${server.address().port}`;
  const ticketFor = async (session) => (await call("POST", "/api/events/ticket", { session })).data.ticket;
  assert.equal((await call("POST", "/api/events/ticket")).status, 401, "anonymous callers get no stream ticket");
  const ownerTicket = await ticketFor(owner.session);
  const cashierTicket = await ticketFor(cash.session);
  const otherBizTicket = await ticketFor(intoB.session);
  const listening = Promise.all([
    collectEvents(`${base}/api/events/stream?ticket=${ownerTicket}`, 4000),
    collectEvents(`${base}/api/events/stream?ticket=${cashierTicket}`, 4000),
    collectEvents(`${base}/api/events/stream?ticket=${otherBizTicket}`, 4000),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const liveBill = await call("POST", "/api/billing", { session: owner.session, body: { outlet_id: outlet2.id, items: item, payment_type: "Cash" } });
  assert.equal(liveBill.status, 201);
  await prisma.$transaction(async (tx) => {
    await publishChange({ businessId: bizA, resource: "bills", action: "rolled_back_probe" }, { tx });
    throw new Error("rollback");
  }).catch(() => {});
  const [ownerStream, cashierStream, otherStream] = await listening;
  assert.equal(ownerStream.status, 200);
  assert.ok(ownerStream.events.some((event) => event.resource === "bills" && event.record_id === liveBill.data.id), "the owner hears about the new bill");
  assert.ok(!ownerStream.events.some((event) => event.action === "rolled_back_probe"), "a rolled-back change is never announced");
  assert.ok(!cashierStream.events.some((event) => event.outlet_id === outlet2.id), "an outlet-restricted cashier hears nothing about other outlets");
  assert.equal(otherStream.events.length, 0, "another business hears nothing");
  assert.equal((await collectEvents(`${base}/api/events/stream?ticket=${ownerTicket}`, 500)).status, 401, "tickets are single-use");

  console.log("Access control: outlet scope, guarded reads, multi-business login and password change passed");
} finally {
  await stopRealtime();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await prisma.business.deleteMany({ where: { id: { in: [bizA, bizB] } } });
  await prisma.$disconnect();
}
