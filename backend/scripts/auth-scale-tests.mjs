// Staff sign-in at scale: password checks run off the main thread (logins at shift change do not stall billing),
// unknown accounts are refused like wrong passwords, and expired sessions are cleaned up.
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { hashPassword, hashPasswordAsync, verifyPassword, verifyPasswordAsync } from "../src/core/auth/passwords.js";
import { purgeExpiredSessions } from "../src/core/maintenance/maintenance.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8), id = `authscale-${suffix}`, tenantId = `tenant-${id}`, password = randomUUID();
const api = http.createServer(app);
let checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
try {
  await connectDatabase();
  const asyncHash = await hashPasswordAsync("Secret-123");
  eq([verifyPassword("Secret-123", asyncHash), await verifyPasswordAsync("Secret-123", hashPassword("Secret-123"))], [true, true], "both forms read each other's hashes");
  eq([await verifyPasswordAsync("wrong", asyncHash), await verifyPasswordAsync("anything", null), await verifyPasswordAsync("anything", "pbkdf2$1$x$y")], [false, false, false]);

  await prisma.business.create({ data: { id, tenantId, name: "Auth scale" } });
  const staff = [];
  for (let n = 0; n < 10; n += 1) staff.push(await usersService.createUser({ businessId: id, tenantId, payload: { email: `s${n}-${id}@t.test`, password, role: "Cashier", name: `Staff ${n}`, profile_required: false, permissions: ["billing"] } }));
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${api.address().port}`;
  const login = (email, secret = password) => fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: secret }) });
  // Ten staff sign in at once while another request is served: it must not wait behind the password checks.
  const health = (async () => { const started = performance.now(); await fetch(`${base}/health`); return performance.now() - started; })();
  const results = await Promise.all(staff.map((user) => login(user.email)));
  const healthMs = await health;
  eq(results.map((response) => response.status), staff.map(() => 200));
  assert.ok(healthMs < 1000, `another request waited ${Math.round(healthMs)} ms behind sign-ins`); checks++;
  eq((await login(`nobody-${id}@t.test`)).status, 401, "unknown account refused");
  eq((await login(staff[0].email, "wrong-password")).status, 401, "wrong password refused");

  // Expired sessions are removed; live ones stay.
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.create({ data: { tokenHash: `expired-${suffix}`, userId: users[0].id, expiresAt: new Date(Date.now() - 60000) } });
  const before = await prisma.authSession.count({ where: { userId: { in: users.map((user) => user.id) } } });
  assert.ok(await purgeExpiredSessions() >= 1); checks++;
  eq(await prisma.authSession.count({ where: { userId: { in: users.map((user) => user.id) } } }), before - 1, "only the expired session was removed");
  console.log(`Auth at scale passed (${checks} checks): async password checks, concurrent sign-ins do not block other requests (${Math.round(healthMs)} ms), unknown accounts refused, expired sessions purged.`);
} finally {
  if (api.listening) await new Promise((resolve) => api.close(resolve));
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
