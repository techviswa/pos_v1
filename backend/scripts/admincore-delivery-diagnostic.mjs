import prisma from "../src/database/prisma/client.js";
import { checkAdmincoreHealth } from "../src/core/admincore/admincore.service.js";
const businessId = process.env.DEFAULT_BUSINESS_ID || "demo-business";
try {
  const jobs = await prisma.backgroundJob.findMany({ where: { type: "admincore.notify-change", payload: { path: ["business_id"], equals: businessId } }, select: { status: true, error: true, payload: true, updatedAt: true } });
  const groups = {};
  for (const job of jobs) {
    const reason = job.error?.match(/AdminCore webhook returned \d+/)?.[0] || (job.error?.includes("fetch failed") ? "Connection failed" : job.error?.includes("timed out") ? "Timed out" : job.error ? "Other error (inspect locally)" : "No error");
    const key = `${job.status}: ${reason}`;
    groups[key] = (groups[key] || 0) + 1;
  }
  const health = await checkAdmincoreHealth();
  console.log(JSON.stringify({ configured: health.status !== "not_configured", reachable: health.admincore_reachable, healthy: health.connected, http_status: health.admincore_status_code || null, jobs: groups, failed_resources: [...new Set(jobs.filter((job) => job.status === "failed").map((job) => job.payload.resource))] }, null, 2));
} finally { await prisma.$disconnect(); }
