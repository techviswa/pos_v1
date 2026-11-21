import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import prisma from "../src/database/prisma/client.js";
import app from "../src/app.js";
import { connectDatabase } from "../src/config/db.js";
import env from "../src/config/env.js";
import { runTenantScope, bindTenantScope } from "../src/database/prisma/tenant-context.js";
import { tenantModelPaths, systemModels } from "../src/database/prisma/tenant-guard.js";
import { Prisma } from "@prisma/client";
import { ensureBusiness } from "../src/database/prisma/helpers.js";
import { saasService } from "../src/core/saas/saas.service.js";

const suffix = randomUUID();
const a = `boundary-a-${suffix}`, b = `boundary-b-${suffix}`;
const scope = (businessId) => ({ businessId, tenantId: `tenant-${businessId}` });
const password = randomUUID();
const server = http.createServer(app);
const previousEnabled = env.admincore.enabled;
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; };
try {
  env.admincore.enabled = false;
  await connectDatabase();
  for (const businessId of [a, b]) await saasService.upsertTenantFromAdminCore({ business_id: businessId, tenant_id: `tenant-${businessId}`, name: businessId, plan: "growth", owner_email: `${businessId}@example.invalid`, owner_password: password });
  const pa = await prisma.product.create({ data: { businessId: a, name: `private-${a}`, category: "Food", price: 10, stock: 5 } });
  const pb = await prisma.product.create({ data: { businessId: b, name: `private-${b}`, category: "Food", price: 90, stock: 5 } });
  const ob = await prisma.outlet.create({ data: { businessId: b, name: `outlet-${b}`, code: "PRIVATE" } });
  const orderA = await prisma.order.create({ data: { businessId: a, customerName: "A", channel: "pos", status: "open", total: 10, items: { create: { productId: pa.id, name: pa.name, quantity: 1, price: 10 } } } });
  const orderB = await prisma.order.create({ data: { businessId: b, customerName: `private-${b}`, channel: "pos", status: "open", total: 90, items: { create: { productId: pb.id, name: pb.name, quantity: 1, price: 90 } } } });
  const vb = await prisma.variation.create({ data: { productId: pb.id, name: "Foreign option", price: 1 } });
  await prisma.stateDocument.create({ data: { key: `print:${b}:private`, data: { business_id: b, secret: `private-${b}` } } });
  await ensureBusiness({ tenantId: `tenant-${b}`, businessId: b }); // warm another tenant's cache
  for (const model of Prisma.dmmf.datamodel.models) ok(tenantModelPaths.has(model.name) || systemModels.has(model.name), `${model.name} has no isolation policy`);
  await runTenantScope(scope(a), async () => {
    assert.equal(await prisma.product.findUnique({ where: { id: pb.id } }), null); checks++;
    assert.equal(await prisma.product.count(), 1); checks++;
    assert.deepEqual(await prisma.product.count({ select: { businessId: true } }), { businessId: 1 }); checks++;
    await assert.rejects(prisma.role.deleteMany({})); checks++;
    await assert.rejects(prisma.permission.updateMany({ data: { label: "Attack" } })); checks++;
    await assert.rejects(prisma.$queryRawUnsafe("SELECT 1")); checks++;
    const roles = await prisma.role.findMany({ include: { _count: { select: { users: true } } } });
    assert.equal(roles.reduce((sum, role) => sum + role._count.users, 0), 1); checks++;
    assert.equal((await prisma.product.aggregate({ _sum: { price: true } }))._sum.price, 10); checks++;
    assert.equal(await prisma.variation.findUnique({ where: { id: vb.id } }), null); checks++;
    assert.equal(await prisma.stateDocument.findUnique({ where: { key: `print:${b}:private` } }), null); checks++;
    await assert.rejects(ensureBusiness({ tenantId: `tenant-${b}`, businessId: b })); checks++;
    await assert.rejects(prisma.product.update({ where: { id: pb.id }, data: { name: "Attack" } })); checks++;
    await assert.rejects(prisma.product.create({ data: { businessId: b, name: "Attack", category: "Food", price: 1 } })); checks++;
    await assert.rejects(prisma.product.update({ where: { id: pa.id }, data: { businessId: b } })); checks++;
    await assert.rejects(prisma.product.update({ where: { id: pa.id }, data: { business: { connect: { id: b } } } })); checks++;
    await assert.rejects(prisma.orderItem.create({ data: { orderId: orderB.id, productId: pa.id, name: "Attack", quantity: 1, price: 1 } })); checks++;
    await assert.rejects(prisma.order.update({ where: { id: orderA.id }, data: { items: { create: { productId: pb.id, name: "Attack", quantity: 1, price: 1 } } } })); checks++;
    await assert.rejects(prisma.stateDocument.upsert({ where: { key: `print:${b}:private` }, create: { key: `print:${b}:private`, data: { business_id: a } }, update: { data: { business_id: a } } })); checks++;
    assert.equal((await prisma.product.updateMany({ data: { stock: 6 } })).count, 1); checks++;
    for (const model of tenantModelPaths.keys()) {
      const rows = await prisma[model[0].toLowerCase() + model.slice(1)].findMany({ take: 2 });
      ok(!JSON.stringify(rows).includes(`private-${b}`), `${model} leaked foreign data`);
    }
    assert.deepEqual(await prisma.product.findUnique({ where: { id: pa.id }, select: { name: true } }), { name: pa.name }); checks++;
    const selected = await prisma.order.findUnique({ where: { id: orderA.id }, select: { items: { select: { product: { select: { name: true } } } } } });
    assert.deepEqual(selected.items[0].product, { name: pa.name }); checks++;
    assert.throws(() => bindTenantScope(scope(b))); checks++;
    await prisma.$transaction(async (tx) => {
      assert.equal(await tx.product.findUnique({ where: { id: pb.id } }), null); checks++;
      const fresh = await tx.product.create({ data: { businessId: a, name: "Staged", category: "Food", price: 2, variations: { create: { name: "Fresh", price: 1 } } } });
      ok(fresh.businessId === a, "Transaction create lost scope");
    });
  });
  assert.equal((await prisma.product.findUnique({ where: { id: pb.id } })).stock, 5); checks++;
  await Promise.all(Array.from({ length: 8 }, (_, index) => runTenantScope(scope(a), () => prisma.$transaction(async (tx) => {
    const child = await tx.variation.create({ data: { productId: pa.id, name: `Concurrent-${index}`, price: 1 } });
    ok(Boolean(child.id), "Reference validation starved an interactive transaction");
  }, { timeout: 15000 }))));
  // An old corrupt relation must fail closed even with a projection that hides businessId.
  // Only the migration/owner connection can construct historical corruption;
  // database triggers now reject it on both application runtime connections.
  const { PrismaClient } = await import("@prisma/client");
  const fixtureOwner = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  let corrupt;
  try { corrupt = await fixtureOwner.orderItem.create({ data: { orderId: orderA.id, productId: pb.id, name: "Corrupt fixture", quantity: 1, price: 1 } }); }
  finally { await fixtureOwner.$disconnect(); }
  const readCorrupt = () => runTenantScope(scope(a), () => prisma.order.findUnique({ where: { id: orderA.id }, select: { items: { select: { product: { select: { name: true } } } } } }));
  if (process.env.TENANT_DATABASE_URL) {
    // RLS can hide the foreign relation before the application sees it.
    assert.ok(!JSON.stringify(await readCorrupt()).includes(pb.name));
  } else await assert.rejects(readCorrupt());
  checks++;
  await prisma.orderItem.delete({ where: { id: corrupt.id } });
  await Promise.all(Array.from({ length: 24 }, (_, index) => runTenantScope(scope(index % 2 ? a : b), async () => {
    await new Promise((resolve) => setTimeout(resolve, index % 4));
    const rows = await prisma.product.findMany();
    ok(rows.every((row) => row.businessId === (index % 2 ? a : b)), "Concurrent request scope leaked");
  })));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${a}@example.invalid`, password }) });
  const sessionId = (await login.json()).data.session_id;
  const headers = { "x-cf-session-id": sessionId, "x-tenant-id": `tenant-${b}`, "x-business-id": b, business_id: b, "content-type": "application/json" };
  const paths = ["products", "orders", "bills", "inventory", "outlets", "staff", "customers", "table-management", "table-management/reservations", "reports", "dashboard/stats", "feedback", "businesses", "sync/export/products", "sync/export/orders", "sync/export/staff", "sync/export/outlets", "sync/export/tables", "sync/export/reservations", "sync/logs/admincore", "printer", "payments", "tips", "attendance", "payroll/runs", "marketing/settings", "reports/schedules", "sync/client-events"];
  for (const requested of paths) {
    const path = requested === "tips" ? "tips/summary" : requested === "attendance" ? "attendance/entries" : requested;
    const response = await fetch(`${base}/api/${path}`, { headers });
    const text = await response.text();
    ok(response.status >= 200 && response.status < 300, `${path} did not exercise a live read (${response.status}): ${text.slice(0,160)}`);
    ok(!text.includes(b) && !text.includes(pb.id) && !text.includes(orderB.id), `${path} leaked another tenant`);
  }
  const scheduled = await fetch(`${base}/api/reports/schedules`, { method: "POST", headers, body: JSON.stringify({ report_key: "sales", recipients: ["owner@example.invalid"] }) });
  assert.equal(scheduled.status, 201); checks++;
  const schedule = (await scheduled.json()).data;
  assert.equal(schedule.business_id, a); checks++;
  for (const businessId of [a, b]) {
    const events = await runTenantScope(scope(businessId), async () => {
      const { syncService } = await import("../src/core/sync/sync.service.js");
      return Promise.all([1, 2].map(() => syncService.recordClientEvent({ ...scope(businessId), user: {}, payload: { resource: "orders", idempotency_key: "shared-key", payload: { name: businessId } } })));
    });
    assert.equal(events[0].id, events[1].id); checks++;
    assert.equal(events[0].business_id, businessId); checks++;
  }
  for (const [method, path, body] of [["GET", `products/${pb.id}`], ["PUT", `products/${pb.id}`, { name: "Attack" }], ["DELETE", `products/${pb.id}`], ["GET", `orders/${orderB.id}`], ["GET", `outlets/${ob.id}`]]) {
    const response = await fetch(`${base}/api/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    ok(response.status >= 400 && response.status < 500, `Foreign ${method} ${path} was accepted (${response.status})`);
  }
  assert.equal((await prisma.product.findUnique({ where: { id: pb.id } })).name, pb.name); checks++;
  console.log(`Tenant boundary passed: ${checks} checks across model guards, nested writes/projections, transactions, cache, concurrency and ${paths.length} HTTP read/export surfaces`);
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  env.admincore.enabled = previousEnabled;
  const users = await prisma.user.findMany({ where: { businessId: { in: [a, b] } }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.business.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: suffix } } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId: { in: [`tenant-${a}`, `tenant-${b}`] } } });
  await prisma.$disconnect();
}
