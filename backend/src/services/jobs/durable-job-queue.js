import { randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { Prisma } from "@prisma/client";
import { runTenantScope } from "../../database/prisma/tenant-context.js";
import { errorMonitor } from "../../shared/utils/error-monitor.js";

const serialize = (job) => job && ({
  ...job, max_attempts: job.maxAttempts, created_at: job.createdAt,
  updated_at: job.updatedAt, run_at: job.runAt,
});

export class DurableJobQueue {
  constructor(client = prisma) {
    this.client = client;
    this.handlers = new Map();
    this.running = false;
    this.busy = false;
  }
  registerHandler(type, handler) { this.handlers.set(type, handler); }
  async enqueue(type, payload = {}, options = {}) {
    return serialize(await this.client.backgroundJob.create({ data: {
      id: options.id || randomUUID(), type, payload,
      maxAttempts: options.maxAttempts || 5, runAt: new Date(options.runAt || Date.now()),
    } }));
  }
  async get(id) { return serialize(await this.client.backgroundJob.findUnique({ where: { id } })); }
  async list({ status } = {}) {
    return (await this.client.backgroundJob.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 100 })).map(serialize);
  }
  async runNext() {
    if (this.busy || !this.handlers.size) return null;
    this.busy = true;
    let heartbeat;
    try {
      const token = randomUUID();
      const job = await this.client.$transaction(async (tx) => {
        // Deleted fixture/business contexts cannot recover through retries. Reject
        // them in a batch so they never block genuine business notifications.
        await tx.$executeRaw(Prisma.sql`UPDATE "BackgroundJob" j SET status='failed', error='Job business context is invalid', "leaseUntil"=NULL, "leaseToken"=NULL, "updatedAt"=NOW()
          WHERE j.type IN (${Prisma.join([...this.handlers.keys()])}) AND j.status IN ('queued','retrying')
          AND COALESCE(j.payload->>'business_id',j.payload->>'businessId') IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "Business" b WHERE b.id=COALESCE(j.payload->>'business_id',j.payload->>'businessId')
            AND b."tenantId"=COALESCE(NULLIF(j.payload->>'tenant_id',''),NULLIF(j.payload->>'tenantId',''),b."tenantId"))`);
        const now = new Date();
        const candidate = await tx.backgroundJob.findFirst({
          where: { type: { in: [...this.handlers.keys()] }, OR: [
            { status: { in: ["queued", "retrying"] }, runAt: { lte: now } },
            { status: "running", leaseUntil: { lt: now } },
          ] }, orderBy: { runAt: "asc" },
        });
        if (!candidate) return null;
        const claimed = await tx.backgroundJob.updateMany({
          where: { id: candidate.id, status: candidate.status, updatedAt: candidate.updatedAt },
          data: { status: "running", attempts: { increment: 1 }, leaseToken: token, leaseUntil: new Date(Date.now() + 120000) },
        });
        return claimed.count ? tx.backgroundJob.findUnique({ where: { id: candidate.id } }) : null;
      });
      if (!job) return null;
      heartbeat = setInterval(() => {
        void this.client.backgroundJob.updateMany({ where: { id: job.id, leaseToken: token, status: "running" },
          data: { leaseUntil: new Date(Date.now() + 120000) } }).catch((error) => errorMonitor.captureException(error));
      }, 30000);
      heartbeat.unref?.();
      try {
        if (job.attempts > job.maxAttempts) {
          throw new Error("Job retry limit reached after worker restart");
        }
        const businessId = job.payload?.business_id || job.payload?.businessId;
        const tenantId = job.payload?.tenant_id || job.payload?.tenantId;
        const business = businessId ? await this.client.business.findFirst({ where: { id: businessId, ...(tenantId ? { tenantId } : {}) }, select: { id: true, tenantId: true } }) : null;
        if (businessId && !business) throw new Error("Job business context is invalid");
        const result = await runTenantScope(business ? { businessId: business.id, tenantId: business.tenantId } : {}, () => this.handlers.get(job.type)(job.payload, serialize(job)));
        await this.client.backgroundJob.updateMany({ where: { id: job.id, leaseToken: token }, data: {
          status: "completed", result: JSON.parse(JSON.stringify(result ?? {})), error: null, leaseUntil: null, leaseToken: null,
        } });
      } catch (error) {
        await this.client.backgroundJob.updateMany({ where: { id: job.id, leaseToken: token }, data: {
          status: job.attempts < job.maxAttempts ? "retrying" : "failed",
          error: String(error.message || error).slice(0, 2000), leaseUntil: null, leaseToken: null,
          runAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(job.attempts - 1, 6))),
        } });
      }
      return this.get(job.id);
    } finally { clearInterval(heartbeat); this.busy = false; }
  }
  start({ intervalMs = 5000 } = {}) {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.wake(), intervalMs);
    this.timer.unref?.();
    this.wake();
  }
  wake() {
    if (!this.running) return;
    this.wakeRequested = true;
    if (this.draining) return;
    this.draining = true;
    void (async () => {
      try {
        for (let count = 0; count < 50 && this.running; count++) {
          this.wakeRequested = false;
          if (!await this.runNext() && !this.wakeRequested) break;
        }
      } catch (error) { errorMonitor.captureException(error, { lifecycle: 'job_worker' }); }
      finally {
        this.draining = false;
        if (this.wakeRequested && this.running) queueMicrotask(() => this.wake());
      }
    })();
  }
  stop() { clearInterval(this.timer); this.running = false; }
  async health() {
    const counts = await this.client.backgroundJob.groupBy({ by: ["status"], _count: true });
    const count = (status) => counts.find((row) => row.status === status)?._count || 0;
    return { running: this.running, durable: true, queued: count("queued") + count("retrying"), running_jobs: count("running"), completed: count("completed"), failed: count("failed"), handlers: [...this.handlers.keys()] };
  }
}
