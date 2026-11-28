// Off-site backups: honest "not configured" status, encrypted backup uploaded to S3-compatible storage and verified
// from the stored copy, tampering detected, retention, nightly claim rules, owner-only data download.
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { backupService, backupsToPrune } from "../src/core/backup/backup.service.js";
import { createBackupStorage } from "../src/core/backup/backup-storage.js";
import { verifyBackup } from "../src/core/backup/backup-archive.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

// A minimal S3-compatible server (path-style): PUT, GET, DELETE objects and ListObjectsV2.
const objects = new Map();
let corruptDownloads = false;
const s3 = http.createServer((req, res) => {
  const url = new URL(req.url, "http://s3.local");
  const [, bucket, ...rest] = url.pathname.split("/");
  const key = decodeURIComponent(rest.join("/"));
  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk)).on("end", () => { objects.set(`${bucket}/${key}`, { body: Buffer.concat(chunks), modified: new Date() }); res.writeHead(200, { ETag: '"x"' }); res.end(); });
    return;
  }
  if (req.method === "DELETE") { objects.delete(`${bucket}/${key}`); res.writeHead(204); return res.end(); }
  if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
    const prefix = url.searchParams.get("prefix") || "";
    const items = [...objects].filter(([name]) => name.startsWith(`${bucket}/${prefix}`)).map(([name, object]) => `<Contents><Key>${name.slice(bucket.length + 1)}</Key><Size>${object.body.length}</Size><LastModified>${object.modified.toISOString()}</LastModified></Contents>`).join("");
    res.writeHead(200, { "Content-Type": "application/xml" });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated>${items}</ListBucketResult>`);
  }
  if (req.method === "GET") {
    const object = objects.get(`${bucket}/${key}`);
    if (!object) { res.writeHead(404, { "Content-Type": "application/xml" }); return res.end("<Error><Code>NoSuchKey</Code></Error>"); }
    const body = Buffer.from(object.body);
    if (corruptDownloads) body[body.length - 100] ^= 0xff;
    res.writeHead(200, { "Content-Length": body.length, "Content-Type": "application/octet-stream" });
    return res.end(body);
  }
  res.writeHead(400); res.end();
});

const suffix = randomUUID().slice(0, 8), id = `backup-${suffix}`, tenantId = `tenant-${id}`, password = randomUUID();
const api = http.createServer(app);
let checks = 0, base;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const call = async (path, session) => { const response = await fetch(base + path, { headers: { "x-cf-session-id": session } }); return { status: response.status, text: await response.text() }; };
// Backup status records are platform-wide: keep the real ones and put them back afterwards.
const statusFilter = { OR: [{ key: "system-backup:status" }, { key: { startsWith: "backup-status:" } }] };
let savedStatus = [];
try {
  await connectDatabase();
  savedStatus = await prisma.stateDocument.findMany({ where: statusFilter });
  // Retention: newest 30 plus the first backup of each of the last 12 months.
  const names = [];
  for (let day = 0; day < 120; day += 1) names.push(`${new Date(Date.UTC(2026, 0, 1) + day * 86400000).toISOString().slice(0, 10)}T21-30-00Z.posbak`);
  const pruned = backupsToPrune([...names, "notes.txt"], { keepDaily: 30, keepMonthly: 12 });
  const kept = names.filter((name) => !pruned.includes(name));
  eq(kept.length, 30 + 3, "30 newest + first of Jan, Feb, Mar (Apr's first is among the newest)");
  eq(kept.includes("2026-01-01T21-30-00Z.posbak") && kept.includes("2026-02-01T21-30-00Z.posbak"), true);
  eq(pruned.includes("notes.txt"), false, "foreign files are never deleted");

  await new Promise((resolve) => s3.listen(0, "127.0.0.1", resolve));
  const config = { ...process.env, BACKUP_S3_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, BACKUP_S3_BUCKET: "pos-test", BACKUP_S3_ACCESS_KEY_ID: "test", BACKUP_S3_SECRET_ACCESS_KEY: "test-secret", BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), BACKUP_HOUR: "3", BACKUP_TIMEZONE: "Asia/Kolkata" };
  const unconfigured = { ...process.env, BACKUP_S3_BUCKET: "", BACKUP_S3_ACCESS_KEY_ID: "", BACKUP_S3_SECRET_ACCESS_KEY: "", BACKUP_ENCRYPTION_KEY: "" };

  await prisma.business.create({ data: { id, tenantId, name: "Backup fixture" } });
  const owner = await usersService.createUser({ businessId: id, tenantId, payload: { email: `o-${id}@t.test`, password, role: "Owner", name: "Owner", profile_required: false } });
  const cashier = await usersService.createUser({ businessId: id, tenantId, payload: { email: `c-${id}@t.test`, password, role: "Cashier", name: "Cashier", profile_required: false, permissions: ["billing"] } });
  await prisma.bill.create({ data: { businessId: id, customerName: "Backup guest", currency: "INR", subtotal: 100, tax: 5, total: 105, status: "paid", invoiceNumber: `BK-${suffix}` } });

  // Not configured: nothing is claimed as backed up.
  const notConfigured = await backupService.run({ config: unconfigured });
  eq([notConfigured.ok, notConfigured.reason, notConfigured.missing.length], [false, "not_configured", 4]);
  eq((await backupService.statusFor(id, unconfigured)).configured, false);
  eq(await backupService.claimScheduledRun({ config: unconfigured, now: new Date("2026-12-01T00:00:00Z") }), null, "no schedule without storage");

  // A real run: encrypted, uploaded, downloaded again and verified.
  const now = new Date();
  const result = await backupService.run({ config, now, trigger: "test" });
  eq([result.ok, result.verified, result.rows > 0], [true, true, true], result.error);
  const stored = [...objects.keys()];
  eq(stored.some((name) => name.startsWith("pos-test/pos-backups/") && name.endsWith(".posbak")), true, "stored under the backup prefix");
  const status = await backupService.statusFor(id, config);
  eq([status.configured, status.last_verified, status.last_success_at, status.storage], [true, true, now.toISOString(), `127.0.0.1 / pos-test`]);
  // The stored file decrypts only with the key and contains this business's bill.
  const local = path.join(os.tmpdir(), `bk-${suffix}.posbak`);
  await createBackupStorage(config).download(result.name, local);
  const check = await verifyBackup({ filePath: local, secret: config.BACKUP_ENCRYPTION_KEY });
  eq([check.ok, check.footer.tables.Bill.rows >= 1], [true, true]);
  const raw = await fs.readFile(local);
  eq(raw.includes(Buffer.from("Backup guest")), false, "the file is encrypted");
  await assert.rejects(verifyBackup({ filePath: local, secret: randomBytes(32).toString("base64url") }), /wrong key or damaged/); checks++;
  await fs.rm(local, { force: true });

  // A damaged copy in storage is caught; the failure is recorded, the last good backup stays reported.
  corruptDownloads = true;
  const damaged = await backupService.run({ config, now: new Date(now.getTime() + 60000), trigger: "test" });
  corruptDownloads = false;
  eq([damaged.ok, /differs|verification|decrypt/.test(damaged.error)], [false, true], damaged.error);
  const afterFailure = await backupService.statusFor(id, config);
  eq([afterFailure.last_success_at, Boolean(afterFailure.last_failure_at), Boolean(afterFailure.last_error)], [now.toISOString(), true, true]);

  // Nightly claims: before 03:00 local nothing; after it one claim; no retry within 30 minutes; none once done today.
  const day = "2031-06-15";
  await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `system-backup:claim:${day}:` } } });
  eq(await backupService.claimScheduledRun({ config, now: new Date(`${day}T21:00:00+05:30`.replace("21:00", "02:00")) }), null, "02:00 local is before the backup hour");
  const first = await backupService.claimScheduledRun({ config, now: new Date(`${day}T03:15:00+05:30`) });
  eq(first?.attempt, 1);
  eq(await backupService.claimScheduledRun({ config, now: new Date(`${day}T03:30:00+05:30`) }), null, "no second try within 30 minutes");
  eq((await backupService.claimScheduledRun({ config, now: new Date(`${day}T04:00:00+05:30`) }))?.attempt, 2, "a retry after 30 minutes");
  await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `system-backup:claim:${day}:` } } });

  // API: status for the Settings screen; the data download is for owners only.
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${api.address().port}`;
  const login = async (user) => { const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password }) }); return (await response.json()).data.session_id; };
  const [ownerS, cashierS] = await Promise.all([owner, cashier].map(login));
  const statusResponse = await call("/api/backups/status", ownerS);
  eq([statusResponse.status, typeof JSON.parse(statusResponse.text).data.configured], [200, "boolean"]);
  eq((await call("/api/backups/status", cashierS)).status, 403);
  const download = await call("/api/backups/my-data", ownerS);
  const exported = JSON.parse(download.text);
  eq([download.status, exported.bills.map((bill) => bill.customer_name || bill.customerName)], [200, ["Backup guest"]], "the owner's file holds their bills");
  eq(exported.business.id || exported.business.business_id, id);
  eq((await call("/api/backups/my-data", cashierS)).status, 403);
  console.log(`Backups passed (${checks} checks): not-configured honesty, encrypted upload verified from storage, wrong key refused, tampering caught, retention, nightly claims, owner-only data download.`);
} finally {
  if (api.listening) await new Promise((resolve) => api.close(resolve));
  if (s3.listening) await new Promise((resolve) => s3.close(resolve));
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: statusFilter }).catch(() => {});
  for (const row of savedStatus) await prisma.stateDocument.create({ data: { key: row.key, data: row.data } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
