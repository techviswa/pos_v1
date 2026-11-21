import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { connectDatabase } from "../src/config/db.js";
import { syncHealth, reconcileSync } from "../src/core/admincore/sync-health.service.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";
import { runTenantScope } from "../src/database/prisma/tenant-context.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";
const suffix = randomUUID(), a = `sync-a-${suffix}`, b = `sync-b-${suffix}`;
const originalFetch = globalThis.fetch, originalConfig = { ...env.admincore };
let remoteState = "pending", checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
try {
  await connectDatabase();
  for (const id of [a, b]) await prisma.business.create({ data: { id, tenantId: `tenant-${id}`, name: "Isolated sync fixture" } });
  for (const id of [a, b]) await prisma.backgroundJob.create({ data: { type: "admincore.notify-change", status: "failed", error: "AdminCore webhook returned 503", payload: { id: `event-${id}`, business_id: id, tenant_id: `tenant-${id}`, resource: "products", action: "deleted", record_id: "old-record" } } });
  await prisma.backgroundJob.create({ data: { type: "admincore.notify-change", status: "failed", error: "Connection failed", payload: { business_id: a, tenant_id: `tenant-${a}`, resource: "products", action: "snapshot" } } });
  Object.assign(env.admincore, { enabled: true, apiBaseUrl: "https://admincore.invalid", syncWebhookUrl: "" });
  globalThis.fetch = async (_url, options = {}) => ({ ok: true, json: async () => options.method === "POST" ? { accepted: true, business_id: "mapped-a", result: { id: "remote-a" } } : [{ id: "remote-a", status: remoteState, result: { status: "success", error_count: 0 } }] });
  await runTenantScope({ businessId: a, tenantId: `tenant-${a}` }, async () => {
    eq((await syncHealth({ businessId: a })).unresolved_failures, 2);
    const first = await reconcileSync({ businessId: a, tenantId: `tenant-${a}` });
    const retry = await reconcileSync({ businessId: a, tenantId: `tenant-${a}` });
    eq(first.jobs[0].job_id, retry.jobs[0].job_id);
    const job = await prisma.backgroundJob.findUnique({ where: { id: first.jobs[0].job_id } });
    eq(job.payload.action, "snapshot"); eq(job.payload.record_id, null);
    eq(job.payload.metadata.reconciles.length, 2);
    const result = await admincoreChangeSyncService.deliverChange(job.payload);
    eq(result.import_verified, false); eq(result.remote_job_id, "remote-a");
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: "completed", result } });
    eq((await syncHealth({ businessId: a })).unresolved_failures, 2);
    remoteState = "synced";
    const verified = await syncHealth({ businessId: a });
    eq(verified.unresolved_failures, 0); eq(verified.historical_failures, 2); eq(verified.reconciliations[0].verified, true);
    eq(verified.reconciliations.length, 1); // A covered failed snapshot is not a successful import.
  });
  eq(await prisma.backgroundJob.count({ where: { status: "failed", payload: { path: ["business_id"], equals: b } } }), 1);
  console.log(`Sync reconciliation passed: ${checks} checks for tenant boundaries, idempotent snapshot requests, no stale-delete replay, acceptance versus import verification and retained failure history.`);
} finally {
  globalThis.fetch = originalFetch; Object.assign(env.admincore, originalConfig);
  for (const businessId of [a, b]) {
    await prisma.backgroundJob.deleteMany({ where: { payload: { path: ["business_id"], equals: businessId } } });
    await prisma.stateDocument.deleteMany({ where: { data: { path: ["business_id"], equals: businessId } } });
  }
  await prisma.business.deleteMany({ where: { id: { in: [a, b] } } });
  await stopRealtime(); await prisma.$disconnect();
}
