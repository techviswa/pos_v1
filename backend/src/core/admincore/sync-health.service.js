import { createHash } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import env from "../../config/env.js";
import { operationalWrite } from "../../shared/utils/operational-write.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "./admincore-change-sync.service.js";
import { checkAdmincoreHealth } from "./admincore.service.js";

const where = (businessId) => ({ type: "admincore.notify-change", payload: { path: ["business_id"], equals: businessId } });
const safeReason = (error) => error?.match(/AdminCore webhook returned \d+/)?.[0] || (error?.includes("fetch failed") ? "Connection failed" : error?.includes("timed out") ? "Connection timed out" : error ? "Delivery failed; inspect server logs" : null);

export async function syncHealth({ businessId }) {
  const jobs = await prisma.backgroundJob.findMany({ where: where(businessId), orderBy: { createdAt: "desc" } });
  const snapshots = jobs.filter((row) => row.payload.action === "snapshot" && row.status === "completed" && row.result?.delivered === true && row.result?.remote_job_id);
  const remoteByBusiness = new Map();
  const remoteStatus = new Map();
  await Promise.all([...new Set(snapshots.map((row) => row.result.remote_business_id).filter(Boolean))].map(async (id) => {
    try {
      const response = await fetch(`${env.admincore.apiBaseUrl.replace(/\/+$/, "")}/api/pos-bridge/change-jobs?business_id=${encodeURIComponent(id)}`, { headers: { "x-admincore-api-key": env.admincore.apiKey }, signal: AbortSignal.timeout(5000) });
      const data = response.ok ? await response.json() : null;
      if (Array.isArray(data)) remoteByBusiness.set(id, data);
    } catch { /* Pending verification stays pending; a network outage is not success. */ }
  }));
  for (const snapshot of snapshots) {
    const remote = remoteByBusiness.get(snapshot.result.remote_business_id)?.find((row) => row.id === snapshot.result.remote_job_id);
    remoteStatus.set(snapshot.id, remote?.status || (snapshot.result.import_verified ? "synced" : "unverified"));
    if (!["synced", "completed"].includes(remote?.status) || remote.result?.status !== "success" || remote.result?.error_count) continue;
    const ids = snapshot.payload.metadata?.reconciles || [];
    if (!ids.length) continue;
    const verifiedAt = new Date().toISOString();
    snapshot.result = { ...snapshot.result, import_verified: true, verified_at: verifiedAt };
    await prisma.backgroundJob.update({ where: { id: snapshot.id }, data: { result: snapshot.result } });
    await prisma.backgroundJob.updateMany({ where: { ...where(businessId), id: { in: ids }, status: "failed" }, data: { result: { reconciled_by: snapshot.id, remote_job_id: remote.id, verified_at: new Date().toISOString() } } });
    for (const row of jobs) if (ids.includes(row.id) && row.status === "failed") row.result = { reconciled_by: snapshot.id };
  }
  const failed = jobs.filter((row) => row.status === "failed" && !row.result?.reconciled_by);
  return { configured: admincoreChangeSyncService.isConfigured(), pending_notifications: jobs.filter((row) => ["queued", "retrying", "running"].includes(row.status)).length,
    unresolved_failures: failed.length, historical_failures: jobs.filter((row) => row.status === "failed").length,
    resources: [...new Set(failed.map((row) => row.payload.resource))],
    failures: failed.map((row) => ({ id: row.id, resource: row.payload.resource, reason: safeReason(row.error), updated_at: row.updatedAt })),
    reconciliations: snapshots.map((row) => ({ id: row.id, resource: row.payload.resource, remote_status: remoteStatus.get(row.id) || "unverified", verified: row.result.import_verified === true, notification_status: row.status })),
    message: "Delivery acceptance is not proof of import. Reconciliation is verified only after AdminCore completes its current-data snapshot." };
}

export async function reconcileSync({ businessId, tenantId }) {
  if (!admincoreChangeSyncService.isConfigured()) throw createHttpError({ statusCode: 409, message: "Configure the AdminCore connection before reconciling" });
  if (!(await checkAdmincoreHealth()).connected) throw createHttpError({ statusCode: 503, message: "AdminCore is unavailable. Restore its connection before requesting reconciliation." });
  const health = await syncHealth({ businessId });
  if (!health.unresolved_failures) return { queued: 0, message: "No unresolved delivery failures" };
  const failedIds = health.failures.map((row) => row.id).sort();
  const priorFailedImports = health.reconciliations.filter((row) => ["failed", "rejected"].includes(row.remote_status)).map((row) => row.id).sort();
  const requestId = createHash("sha256").update([...failedIds, ...priorFailedImports].join(",")).digest("hex");
  return operationalWrite({ businessId, kind: "sync-reconciliation", payload: { request_id: requestId } }, async (tx) => {
    const queued = [];
    for (const resource of health.resources) {
      const result = await admincoreChangeSyncService.notifyChange({ id: `reconcile_${requestId}_${resource}`, businessId, tenantId, resource, action: "snapshot", metadata: { reconciles: health.failures.filter((row) => row.resource === resource).map((row) => row.id) } }, { tx });
      if (!result.queued) throw createHttpError({ statusCode: 503, message: "Reconciliation could not be queued" });
      queued.push({ resource, job_id: result.job_id });
    }
    return { queued: queued.length, jobs: queued, message: "Current snapshots queued; old failures remain visible until import is verified." };
  });
}
