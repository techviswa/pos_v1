import prisma from "../src/database/prisma/client.js";
import { syncHealth, reconcileSync } from "../src/core/admincore/sync-health.service.js";
import { runTenantScope } from "../src/database/prisma/tenant-context.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";
import { jobQueue } from "../src/services/jobs/job-queue.js";
try {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: process.env.DEFAULT_BUSINESS_ID || "demo-business" } });
  await runTenantScope({ businessId: business.id, tenantId: business.tenantId }, async () => {
    if (process.argv.includes("--refresh-ack")) {
      const jobs = await prisma.backgroundJob.findMany({ where: { type: "admincore.notify-change", status: "completed", payload: { path: ["business_id"], equals: business.id } } });
      for (const job of jobs.filter((row) => row.payload.action === "snapshot" && row.payload.metadata?.reconciles?.length && !row.result?.remote_job_id)) {
        // Stable event IDs make this acknowledgement refresh idempotent remotely.
        const result = await admincoreChangeSyncService.deliverChange(job.payload);
        await prisma.backgroundJob.update({ where: { id: job.id }, data: { result } });
      }
    }
    if (process.argv.includes("--queue")) console.log(JSON.stringify(await reconcileSync({ businessId: business.id, tenantId: business.tenantId })));
    if (process.argv.includes("--run-pending")) for (let index = 0; index < 20; index++) { if (!await jobQueue.runNext()) break; }
    const health = await syncHealth({ businessId: business.id });
    console.log(JSON.stringify({ pending: health.pending_notifications, unresolved_failures: health.unresolved_failures, historical_failures: health.historical_failures, reconciliations: health.reconciliations }, null, 2));
  });
} finally { await stopRealtime(); await prisma.$disconnect(); }
