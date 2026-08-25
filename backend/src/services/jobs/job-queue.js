import { errorMonitor } from "../../shared/utils/error-monitor.js";

const jobs = new Map();
const handlers = new Map();

const nowIso = () => new Date().toISOString();

const serializeJob = (job) => ({
  id: job.id,
  type: job.type,
  status: job.status,
  attempts: job.attempts,
  max_attempts: job.maxAttempts,
  payload: job.payload,
  result: job.result,
  error: job.error,
  created_at: job.createdAt,
  updated_at: job.updatedAt,
  run_at: job.runAt,
});

class JobQueue {
  constructor() {
    this.running = false;
    this.timer = null;
  }

  registerHandler(type, handler) {
    handlers.set(type, handler);
  }

  enqueue(type, payload = {}, options = {}) {
    const id = options.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id,
      type,
      payload,
      status: "queued",
      attempts: 0,
      maxAttempts: Number(options.maxAttempts || 3),
      result: null,
      error: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      runAt: options.runAt || nowIso(),
    };

    jobs.set(id, job);
    return serializeJob(job);
  }

  list({ status } = {}) {
    return [...jobs.values()]
      .filter((job) => !status || job.status === status)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(serializeJob);
  }

  get(jobId) {
    const job = jobs.get(jobId);
    return job ? serializeJob(job) : null;
  }

  async runNext() {
    const now = Date.now();
    const job = [...jobs.values()].find(
      (candidate) =>
        ["queued", "retrying"].includes(candidate.status) && new Date(candidate.runAt).getTime() <= now,
    );

    if (!job) {
      return null;
    }

    const handler = handlers.get(job.type);
    job.status = "running";
    job.attempts += 1;
    job.updatedAt = nowIso();

    try {
      if (!handler) {
        throw new Error(`No job handler registered for ${job.type}`);
      }

      job.result = await handler(job.payload, serializeJob(job));
      job.status = "completed";
      job.updatedAt = nowIso();
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.updatedAt = nowIso();
      errorMonitor.captureException(error, { job_id: job.id, job_type: job.type, attempts: job.attempts });
      if (job.attempts < job.maxAttempts) {
        job.status = "retrying";
        job.runAt = new Date(Date.now() + job.attempts * 5000).toISOString();
      } else {
        job.status = "failed";
      }
    }

    return serializeJob(job);
  }

  start({ intervalMs = 5000 } = {}) {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => {
      void this.runNext();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.running = false;
    this.timer = null;
  }

  health() {
    const list = [...jobs.values()];
    return {
      running: this.running,
      queued: list.filter((job) => ["queued", "retrying"].includes(job.status)).length,
      running_jobs: list.filter((job) => job.status === "running").length,
      completed: list.filter((job) => job.status === "completed").length,
      failed: list.filter((job) => job.status === "failed").length,
      handlers: [...handlers.keys()],
    };
  }
}

export const jobQueue = new JobQueue();
