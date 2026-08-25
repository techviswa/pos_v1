import { jobQueue } from "../jobs/job-queue.js";

const printJobs = new Map();
const agentHeartbeats = new Map();

const nowIso = () => new Date().toISOString();

const serializePrintJob = (job) => ({
  id: job.id,
  type: job.type,
  target: job.target,
  status: job.status,
  copies: job.copies,
  auto_print: job.autoPrint,
  payload: job.payload,
  error: job.error,
  created_at: job.createdAt,
  updated_at: job.updatedAt,
  completed_at: job.completedAt,
  claimed_at: job.claimedAt,
  claimed_by: job.claimedBy,
});

class PrinterService {
  constructor() {
    jobQueue.registerHandler("printer.print", async ({ print_job_id: printJobId }) => {
      const job = printJobs.get(printJobId);
      if (!job) {
        throw new Error(`Print job ${printJobId} not found`);
      }

      job.status = job.autoPrint ? "sent_to_printer_service" : "queued_for_manual_print";
      job.updatedAt = nowIso();
      return serializePrintJob(job);
    });
  }

  queuePrintJob({ type = "receipt", target = "default", payload = {}, copies = 1, autoPrint = false } = {}) {
    const id = `print_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id,
      type,
      target,
      payload,
      copies: Math.max(1, Number(copies || 1)),
      autoPrint: Boolean(autoPrint),
      status: "queued",
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      claimedAt: null,
      claimedBy: null,
    };

    printJobs.set(id, job);
    const backgroundJob = jobQueue.enqueue("printer.print", { print_job_id: id });
    return {
      ...serializePrintJob(job),
      background_job_id: backgroundJob.id,
    };
  }

  listPrintJobs({ status } = {}) {
    return [...printJobs.values()]
      .filter((job) => !status || job.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(serializePrintJob);
  }

  getPrintJob(jobId) {
    const job = printJobs.get(jobId);
    return job ? serializePrintJob(job) : null;
  }

  completePrintJob(jobId) {
    const job = printJobs.get(jobId);
    if (!job) return null;
    job.status = "completed";
    job.completedAt = nowIso();
    job.updatedAt = nowIso();
    return serializePrintJob(job);
  }

  failPrintJob(jobId, error = "Printer service failed") {
    const job = printJobs.get(jobId);
    if (!job) return null;
    job.status = "failed";
    job.error = error;
    job.updatedAt = nowIso();
    return serializePrintJob(job);
  }

  recordAgentHeartbeat({ agentId = "default-agent", payload = {} } = {}) {
    const heartbeat = {
      agent_id: agentId,
      status: payload.status || "online",
      printers: payload.printers || [],
      version: payload.version || null,
      last_seen_at: nowIso(),
    };
    agentHeartbeats.set(agentId, heartbeat);
    return heartbeat;
  }

  listAgents() {
    return [...agentHeartbeats.values()].sort((left, right) =>
      String(right.last_seen_at).localeCompare(String(left.last_seen_at)),
    );
  }

  claimNextPrintJob({ agentId = "default-agent", target } = {}) {
    const nextJob = [...printJobs.values()]
      .filter((job) => ["queued", "sent_to_printer_service", "queued_for_manual_print"].includes(job.status))
      .filter((job) => !target || job.target === target || job.target === "default")
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))[0];

    if (!nextJob) {
      return null;
    }

    nextJob.status = "claimed";
    nextJob.claimedAt = nowIso();
    nextJob.claimedBy = agentId;
    nextJob.updatedAt = nowIso();
    printJobs.set(nextJob.id, nextJob);
    return serializePrintJob(nextJob);
  }
}

export const printerService = new PrinterService();
