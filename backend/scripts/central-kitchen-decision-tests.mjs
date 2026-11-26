// Outlet stock requests (purchase orders) and delivery routes move through their real life cycle from the
// Central Kitchen screen: approve dispatches stock from the central store, reject needs a reason, and routes go
// scheduled -> in transit -> completed. Decisions are one-way and only for managers of the right business.
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8), a = `ck-decide-a-${suffix}`, b = `ck-decide-b-${suffix}`, password = randomUUID();
const scope = (businessId) => ({ businessId, tenantId: `tenant-${businessId}` });
const api = http.createServer(app);
const old = env.admincore.enabled;
let base, checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const call = async (method, path, body, session) => {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json().catch(() => null);
  return { status: response.status, data: json?.data ?? json };
};
try {
  env.admincore.enabled = false;
  await connectDatabase();
  for (const id of [a, b]) await prisma.business.create({ data: { id, tenantId: scope(id).tenantId, name: "CK decision fixture" } });
  const outlet = await prisma.outlet.create({ data: { businessId: a, name: "Outlet", code: `O${suffix}`, status: "active" } });
  const flour = await prisma.inventoryItem.create({ data: { businessId: a, name: "Flour", unit: "kg", stock: 10, reorderLevel: 1, conversionCost: 40 } });
  const make = (role, businessId = a, permissions) => usersService.createUser({ ...scope(businessId), payload: { name: role, role, email: `${role}-${businessId}@example.invalid`, password, profile_required: false, permissions } });
  const [owner, cashier, outsider] = await Promise.all([make("Owner"), make("Cashier", a, ["central_kitchen", "inventory"]), make("Owner", b)]);
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${api.address().port}`;
  const login = async (user) => (await call("POST", "/api/auth/login", { email: user.email, password })).data.session_id;
  const [ownerS, cashierS, outsiderS] = await Promise.all([owner, cashier, outsider].map(login));
  const request = (quantity) => call("POST", "/api/central-kitchen/purchase-orders", { outlet_id: outlet.id, priority: "High", request_id: randomUUID(), items: [{ inventory_id: flour.id, requested_quantity: quantity }] }, ownerS);

  // Approve: stock leaves the central store as a transfer linked to the request; the outlet then confirms receipt.
  const po = (await request(4)).data;
  eq((await call("POST", `/api/central-kitchen/purchase-orders/${po.id}/approve`, {}, cashierS)).status, 403, "cashiers cannot decide");
  eq((await call("POST", `/api/central-kitchen/purchase-orders/${po.id}/approve`, {}, outsiderS)).status, 404, "another business cannot see it");
  const approved = await call("POST", `/api/central-kitchen/purchase-orders/${po.id}/approve`, {}, ownerS);
  eq(approved.status, 200); eq(approved.data.dispatched, true);
  eq(Number((await prisma.inventoryItem.findUnique({ where: { id: flour.id } })).stock), 6, "4 kg left the central store");
  const transfer = await prisma.allocation.findUnique({ where: { id: approved.data.transfer_id } });
  eq([transfer.purchaseOrderId, transfer.status, transfer.outletId], [po.id, "approved", outlet.id]);
  const again = await call("POST", `/api/central-kitchen/purchase-orders/${po.id}/approve`, {}, ownerS);
  eq([again.status, again.data.transfer_id], [200, transfer.id], "approving twice returns the first transfer");
  eq(Number((await prisma.inventoryItem.findUnique({ where: { id: flour.id } })).stock), 6, "and moves no more stock");
  eq((await call("POST", `/api/central-kitchen/purchase-orders/${po.id}/reject`, { reason: "late" }, ownerS)).status, 409, "an approved request cannot be rejected");
  let snapshot = (await call("GET", "/api/central-kitchen", null, ownerS)).data;
  eq(snapshot.purchase_orders.find((row) => row.id === po.id).status, "approved");
  eq(snapshot.overview.open_purchase_orders, 1);
  eq((await call("POST", `/api/inventory/transfers/${transfer.id}/receive`, {}, ownerS)).status, 200);
  eq(Number((await prisma.outletInventory.findUnique({ where: { outletId_inventoryItemId: { outletId: outlet.id, inventoryItemId: flour.id } } })).stock), 4, "outlet received 4 kg");
  snapshot = (await call("GET", "/api/central-kitchen", null, ownerS)).data;
  eq(snapshot.purchase_orders.find((row) => row.id === po.id).status, "fulfilled", "received stock closes the request");
  eq(snapshot.overview.open_purchase_orders, 0);

  // Too little central stock: refused with the shortfall, nothing changes.
  const big = (await request(50)).data;
  const short = await call("POST", `/api/central-kitchen/purchase-orders/${big.id}/approve`, {}, ownerS);
  eq(short.status, 409); assert.match(JSON.stringify(short.data), /Flour \(have 6 kg, need 50\)/); checks++;
  eq((await prisma.purchaseOrder.findUnique({ where: { id: big.id } })).status, "pending");
  eq(await prisma.allocation.count({ where: { purchaseOrderId: big.id } }), 0);
  // Reject needs a reason, which is kept on the request.
  eq((await call("POST", `/api/central-kitchen/purchase-orders/${big.id}/reject`, {}, ownerS)).status, 400);
  eq((await call("POST", `/api/central-kitchen/purchase-orders/${big.id}/reject`, { reason: "Order a smaller batch" }, ownerS)).data.status, "rejected");
  assert.match((await prisma.purchaseOrder.findUnique({ where: { id: big.id } })).notes, /Order a smaller batch/); checks++;
  eq((await call("POST", `/api/central-kitchen/purchase-orders/${big.id}/approve`, {}, ownerS)).status, 409, "a rejected request cannot be approved");

  // Routes: scheduled -> in transit -> completed, in that order only.
  const route = (await call("POST", "/api/central-kitchen/routes", { route_name: "Morning run", request_id: randomUUID(), stops: [{ outlet_id: outlet.id }] }, ownerS)).data;
  eq((await call("POST", `/api/central-kitchen/routes/${route.id}/complete`, {}, ownerS)).status, 409, "cannot complete before starting");
  eq((await call("POST", `/api/central-kitchen/routes/${route.id}/start`, {}, cashierS)).status, 403);
  eq((await call("POST", `/api/central-kitchen/routes/${route.id}/start`, {}, outsiderS)).status, 404);
  eq((await call("POST", `/api/central-kitchen/routes/${route.id}/start`, {}, ownerS)).data.status, "in_transit");
  eq((await call("GET", "/api/central-kitchen", null, ownerS)).data.overview.scheduled_routes, 1, "a route in transit is still active");
  eq((await call("POST", `/api/central-kitchen/routes/${route.id}/complete`, {}, ownerS)).data.status, "completed");
  eq((await call("GET", "/api/central-kitchen", null, ownerS)).data.overview.scheduled_routes, 0);
  eq((await call("POST", `/api/central-kitchen/routes/${route.id}/start`, {}, ownerS)).status, 409, "a completed route cannot restart");
  console.log(`Central kitchen decisions passed (${checks} checks): approve dispatches linked stock once, shortfalls refused, reject needs a reason, routes follow their life cycle, role and business checks.`);
} finally {
  env.admincore.enabled = old;
  if (api.listening) await new Promise((resolve) => api.close(resolve));
  const users = await prisma.user.findMany({ where: { businessId: { in: [a, b] } }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id: { in: [a, b] } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: suffix } } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
