import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import prisma from "../../database/prisma/client.js";
import { verifyBackup, writeBackup } from "./backup-archive.js";
import { createBackupStorage, missingBackupSettings, storageLabel } from "./backup-storage.js";
import { DEFAULT_TIMEZONE, isValidTimezone, localDate, localHour } from "../../shared/utils/business-time.js";

// Nightly off-site backup of the whole database: written, uploaded, downloaded again and verified, old copies pruned.
// Status is recorded for the platform (system-backup:status) and for each business (backup-status:<business>) so
// owners see the real last backup in Settings. Nothing is reported as backed up unless the copy in storage verified.

const STATUS_KEY = "system-backup:status";
const businessKey = (businessId) => `backup-status:${businessId}`;
const NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.posbak$/;
const MAX_ATTEMPTS_PER_DAY = 3, RETRY_AFTER_MS = 30 * 60 * 1000;

export const backupSchedule = (config = process.env) => ({
  hour: Math.min(23, Math.max(0, Number.parseInt(config.BACKUP_HOUR ?? "3", 10) || 0)),
  timezone: isValidTimezone(config.BACKUP_TIMEZONE) ? config.BACKUP_TIMEZONE : DEFAULT_TIMEZONE,
  keepDaily: Math.max(7, Number.parseInt(config.BACKUP_KEEP_DAILY ?? "30", 10) || 30),
  keepMonthly: Math.max(0, Number.parseInt(config.BACKUP_KEEP_MONTHLY ?? "12", 10) || 12),
});
// The owner connection sees every business and the migration list; a restricted role cannot read the latter.
const connectionString = (config = process.env) => config.BACKUP_DATABASE_URL || config.DATABASE_URL || config.SYSTEM_DATABASE_URL;
const backupName = (date) => `${date.toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-")}.posbak`;
const fileSha256 = (filePath) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  createReadStream(filePath).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
});

/** Which stored backups to delete: keep the newest keepDaily, plus the oldest of each of the last keepMonthly months. */
export function backupsToPrune(names, { keepDaily, keepMonthly }) {
  const backups = names.filter((name) => NAME.test(name)).sort().reverse();
  const keep = new Set(backups.slice(0, keepDaily));
  const firstOfMonth = new Map();
  for (const name of [...backups].reverse()) { const month = name.slice(0, 7); if (!firstOfMonth.has(month)) firstOfMonth.set(month, name); }
  for (const month of [...firstOfMonth.keys()].sort().reverse().slice(0, keepMonthly)) keep.add(firstOfMonth.get(month));
  return backups.filter((name) => !keep.has(name));
}

async function writeStatus(update) {
  const current = (await prisma.stateDocument.findUnique({ where: { key: STATUS_KEY } }))?.data || {};
  const data = { ...current, ...update, history: [...(update.entry ? [update.entry] : []), ...(current.history || [])].slice(0, 20) };
  delete data.entry;
  await prisma.stateDocument.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, data }, update: { data } });
  // Each business sees the platform backup that contains its data.
  const businesses = await prisma.business.findMany({ select: { id: true } });
  const visible = { last_success_at: data.last_success_at || null, last_verified: Boolean(data.last_verified), last_bytes: data.last_bytes || null, last_failure_at: data.last_failure_at || null, last_error: data.last_error || null, storage: data.storage || null };
  for (const business of businesses) {
    const record = { business_id: business.id, ...visible };
    await prisma.stateDocument.upsert({ where: { key: businessKey(business.id) }, create: { key: businessKey(business.id), data: record }, update: { data: record } });
  }
  return data;
}

export const backupService = {
  /**
   * Takes, uploads and verifies one backup. Returns { ok, name, bytes, rows, verified } or { ok: false, reason }.
   * storage/now/config can be supplied by tests.
   */
  async run({ now = new Date(), trigger = "manual", config = process.env, storage = null } = {}) {
    const missing = missingBackupSettings(config);
    if (missing.length) {
      await writeStatus({ configured: false, missing, last_checked_at: now.toISOString() });
      return { ok: false, reason: "not_configured", missing };
    }
    const store = storage || createBackupStorage(config);
    const name = backupName(now);
    const local = path.join(os.tmpdir(), `pos-backup-${randomUUID()}.posbak`), copy = `${local}.check`;
    const started = Date.now();
    try {
      const summary = await writeBackup({ connectionString: connectionString(config), filePath: local, secret: config.BACKUP_ENCRYPTION_KEY, now });
      await store.upload(name, local, { sha256: summary.sha256 });
      // Verify the copy that is actually in storage, not the local file.
      await store.download(name, copy);
      if (await fileSha256(copy) !== summary.sha256) throw new Error("The stored copy differs from the file that was uploaded");
      const check = await verifyBackup({ filePath: copy, secret: config.BACKUP_ENCRYPTION_KEY });
      if (!check.ok) throw new Error(`The stored backup failed verification: ${check.problems.slice(0, 3).join("; ")}`);
      const rows = Object.values(summary.tables).reduce((sum, table) => sum + table.rows, 0);
      const pruned = backupsToPrune((await store.list()).map((item) => item.name), backupSchedule(config));
      for (const old of pruned) await store.remove(old);
      const entry = { name, at: now.toISOString(), trigger, ok: true, bytes: summary.bytes, rows, tables: Object.keys(summary.tables).length, seconds: Math.round((Date.now() - started) / 1000), pruned: pruned.length };
      await writeStatus({ configured: true, missing: [], storage: storageLabel(config), last_success_at: now.toISOString(), last_name: name, last_bytes: summary.bytes, last_rows: rows, last_verified: true, last_migrations: summary.migrations.length, last_error: null, entry });
      return { ok: true, name, bytes: summary.bytes, rows, verified: true, pruned: pruned.length };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 300);
      await writeStatus({ configured: true, missing: [], storage: storageLabel(config), last_failure_at: now.toISOString(), last_error: message, entry: { name, at: now.toISOString(), trigger, ok: false, error: message } }).catch(() => {});
      return { ok: false, reason: "failed", error: message };
    } finally {
      await fs.rm(local, { force: true }).catch(() => {});
      await fs.rm(copy, { force: true }).catch(() => {});
    }
  },

  /** What an owner sees in Settings for their business. */
  async statusFor(businessId, config = process.env) {
    const record = (await prisma.stateDocument.findUnique({ where: { key: businessKey(businessId) } }))?.data || {};
    const schedule = backupSchedule(config);
    const missing = missingBackupSettings(config);
    return {
      configured: !missing.length, missing,
      schedule: { hour: schedule.hour, timezone: schedule.timezone, keep_daily: schedule.keepDaily, keep_monthly: schedule.keepMonthly },
      storage: missing.length ? null : storageLabel(config),
      last_success_at: record.last_success_at || null, last_verified: Boolean(record.last_verified), last_bytes: record.last_bytes || null,
      last_failure_at: record.last_failure_at || null, last_error: record.last_error ? "The last backup attempt failed. The platform team has the details." : null,
    };
  },

  /** True when today's scheduled backup is due: after the backup hour, not yet done today, fewer than 3 tries. */
  async claimScheduledRun({ now = new Date(), config = process.env } = {}) {
    if (missingBackupSettings(config).length) return null;
    const { hour, timezone } = backupSchedule(config);
    if (localHour(now, timezone) < hour) return null;
    const today = localDate(now, timezone);
    const status = (await prisma.stateDocument.findUnique({ where: { key: STATUS_KEY } }))?.data;
    if (status?.last_success_at && localDate(status.last_success_at, timezone) === today) return null;
    const attempts = await prisma.stateDocument.findMany({ where: { key: { startsWith: `system-backup:claim:${today}:` } }, select: { data: true } });
    if (attempts.length >= MAX_ATTEMPTS_PER_DAY) return null;
    const lastAttempt = Math.max(0, ...attempts.map((row) => Date.parse(row.data?.at) || 0));
    if (attempts.length && now.getTime() - lastAttempt < RETRY_AFTER_MS) return null;
    try {
      // One server wins each attempt number; the others skip.
      await prisma.stateDocument.create({ data: { key: `system-backup:claim:${today}:${attempts.length + 1}`, data: { at: now.toISOString() } } });
      return { day: today, attempt: attempts.length + 1 };
    } catch (error) {
      if (error?.code === "P2002") return null;
      throw error;
    }
  },
};

let timer = null;
/** Checks every 15 minutes whether the nightly backup is due (BACKUP_SCHEDULER=off disables it on an instance). */
export function startBackupScheduler({ logger, intervalMs = 15 * 60 * 1000 } = {}) {
  if (timer || String(process.env.BACKUP_SCHEDULER || "").toLowerCase() === "off") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const claim = await backupService.claimScheduledRun();
      if (!claim) return;
      const result = await backupService.run({ trigger: `scheduled (attempt ${claim.attempt})` });
      if (result.ok) logger?.info?.(`Backup ${result.name} stored and verified (${Math.round(result.bytes / 1048576)} MB, ${result.rows} rows)`);
      else logger?.error?.(`Backup failed: ${result.error || result.reason}`);
    } catch (error) {
      logger?.error?.(`Backup scheduler error: ${error.message}`);
    } finally { running = false; }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}
export const stopBackupScheduler = () => { clearInterval(timer); timer = null; };
