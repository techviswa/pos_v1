import { randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { readState, writeState } from "../../database/prisma/state-store.js";

const jobKey = (businessId, id) => `print:${businessId}:${id}`;
const now = () => new Date().toISOString();

class PrinterService {
  async queuePrintJob({ businessId, type = "receipt", target = "default", payload = {}, copies = 1, autoPrint = false } = {}) {
    if (!businessId) throw new Error("Printer business context is required");
    const id = randomUUID();
    const job = { id, business_id: businessId, type, target, payload, copies: Math.min(10, Math.max(1, Number(copies) || 1)),
      auto_print: Boolean(autoPrint), status: "queued", error: null, created_at: now(), updated_at: now(),
      completed_at: null, claimed_at: null, claimed_by: null };
    return writeState(jobKey(businessId, id), job);
  }
  async listPrintJobs({ businessId, status } = {}) {
    const rows = await prisma.stateDocument.findMany({ where: { key: { startsWith: `print:${businessId}:` } }, orderBy: { updatedAt: "desc" }, take: 200 });
    return rows.map((row) => row.data).filter((row) => !status || row.status === status);
  }
  getPrintJob(id, businessId) { return readState(jobKey(businessId, id)); }
  async completePrintJob(id, businessId, agentId) {
    return this.finish(id, businessId, agentId, "completed");
  }
  async failPrintJob(id, error, businessId, agentId) {
    return this.finish(id, businessId, agentId, "failed", error);
  }
  async finish(id, businessId, agentId, status, error = null) {
    return prisma.$transaction(async (tx) => {
      const key = jobKey(businessId, id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const job = await readState(key, null, tx);
      if (!job || (agentId && job.claimed_by !== agentId)) return null;
      if (job.status === "completed") return job;
      return writeState(key, { ...job, status, error, updated_at: now(), completed_at: status === "completed" ? now() : null }, tx);
    });
  }
  recordAgentHeartbeat({ businessId, agentId = "default-agent", payload = {} }) {
    return writeState(`printer-agent:${businessId}:${agentId}`, { agent_id: agentId, business_id: businessId,
      status: "online", printers: payload.printers || [], version: payload.version || null, last_seen_at: now() });
  }
  async listAgents(businessId) {
    return (await prisma.stateDocument.findMany({ where: { key: { startsWith: `printer-agent:${businessId}:` } } })).map((row) => row.data);
  }
  async claimNextPrintJob({ businessId, agentId = "default-agent", target = "default" }) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`printer:${businessId}`}))`;
      const rows = await tx.stateDocument.findMany({ where: { key: { startsWith: `print:${businessId}:` }, data: { path: ["status"], equals: "queued" } }, orderBy: { updatedAt: "asc" }, take: 200 });
      const row = rows.find((row) => row.data.target === target || row.data.target === "default");
      if (!row) return null;
      return writeState(row.key, { ...row.data, status: "printing", claimed_by: agentId, claimed_at: now(), updated_at: now() }, tx);
    });
  }
}
export const printerService = new PrinterService();
