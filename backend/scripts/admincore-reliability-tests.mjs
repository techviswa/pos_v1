import assert from "node:assert/strict";
import env from "../src/config/env.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";
import { checkAdmincoreHealth } from "../src/core/admincore/admincore.service.js";
import { jobQueue } from "../src/services/jobs/job-queue.js";
import { DurableJobQueue } from "../src/services/jobs/durable-job-queue.js";
import prisma from "../src/database/prisma/client.js";
import { randomUUID } from "node:crypto";

const originalFetch = globalThis.fetch;
const originalConfig = { ...env.admincore };
const originalFailure = admincoreChangeSyncService.recordDeliveryFailure;
const failures = [];
const testQueue = new DurableJobQueue();
const testType = `test.admincore.${randomUUID()}`;
testQueue.registerHandler(testType, (event) => admincoreChangeSyncService.deliverChange(event));
try {
  Object.assign(env.admincore, { enabled: true, apiBaseUrl: "https://admincore.invalid", syncWebhookUrl: "" });
  admincoreChangeSyncService.recordDeliveryFailure = async (_event, message) => failures.push(message);
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const health = await checkAdmincoreHealth();
  assert.equal(health.connected, false);
  assert.equal(health.admincore_reachable, true);
  assert.equal(health.status, "error");
  await testQueue.enqueue(testType, { resource: "orders" }, { maxAttempts: 3 });
  const retry = await testQueue.runNext();
  assert.equal(retry.status, "retrying");
  assert.match(retry.error, /503/);
  globalThis.fetch = async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); };
  await testQueue.enqueue(testType, { resource: "products" }, { maxAttempts: 1 });
  const failed = await testQueue.runNext();
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /timed out/);
  assert.equal(failures.length, 2);
  // A crashed worker may leave its final permitted attempt with an expired lease.
  // Recover the job without delivering the business change a second time.
  const abandoned = await testQueue.enqueue(testType, { resource: "orders" }, { maxAttempts: 1 });
  await prisma.backgroundJob.update({ where: { id: abandoned.id }, data: {
    status: "running", attempts: 1, leaseToken: "stopped-worker",
    leaseUntil: new Date(0), runAt: new Date(0),
  } });
  const exhausted = await testQueue.runNext();
  assert.equal(exhausted.id, abandoned.id);
  assert.equal(exhausted.status, "failed");
  assert.equal(failures.length, 2, "An exhausted job must not call its delivery handler again");
  assert.equal(exhausted.leaseToken, null);
  const recoverable = await testQueue.enqueue(testType, { resource: "orders" }, { maxAttempts: 2 });
  await prisma.backgroundJob.update({ where: { id: recoverable.id }, data: {
    status: "running", attempts: 1, leaseToken: "stopped-worker",
    leaseUntil: new Date(0), runAt: new Date(0),
  } });
  let recoveredDeliveries = 0;
  testQueue.registerHandler(testType, async () => { recoveredDeliveries += 1; return { delivered: true }; });
  const recovered = await testQueue.runNext();
  assert.equal(recovered.id, recoverable.id);
  assert.equal(recovered.status, "completed");
  assert.equal(recovered.attempts, 2);
  assert.equal(recoveredDeliveries, 1, "A remaining attempt must still run after recovery");
  console.log("AdminCore HTTP failure, timeout, retry, exhaustion, and crash recovery checks passed");
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(env.admincore, originalConfig);
  admincoreChangeSyncService.recordDeliveryFailure = originalFailure;
  jobQueue.stop();
  await prisma.backgroundJob.deleteMany({ where: { type: testType } });
  await prisma.$disconnect();
}
