// Restore drill without touching live data: backs up the database to a temporary file, verifies it, restores it
// into a temporary schema with the same tables and foreign keys, compares every table, then drops the schema.
//   node scripts/backup-drill.mjs
import "../src/config/env.js";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { restoreBackup, verifyBackup, writeBackup } from "../src/core/backup/backup-archive.js";

const url = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
const secret = process.env.BACKUP_ENCRYPTION_KEY || randomBytes(32).toString("base64url");
const file = path.join(os.tmpdir(), `drill-${Date.now()}.posbak`), schema = `restore_drill_${Date.now()}`;
const client = new pg.Client({ connectionString: url });
let ok = false;
try {
  const summary = await writeBackup({ connectionString: url, filePath: file, secret });
  const check = await verifyBackup({ filePath: file, secret });
  if (!check.ok) throw new Error(`Verification failed: ${check.problems.join("; ")}`);
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  const { rows: tables } = await client.query(`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname <> '_prisma_migrations'`);
  for (const { relname } of tables) await client.query(`CREATE TABLE "${schema}"."${relname}" (LIKE public."${relname}" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
  const { rows: keys } = await client.query(`SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`);
  await client.query(`SET search_path TO "${schema}"`);
  for (const key of keys) await client.query(`ALTER TABLE ${key.tbl.replace(/^public\./, "")} ADD CONSTRAINT "${key.conname}" ${key.def}`);
  const result = await restoreBackup({ filePath: file, secret, connectionString: url, schema });
  ok = result.ok;
  console.log(`Drill: backup ${(summary.bytes / 1048576).toFixed(1)} MB, ${result.rows} rows in ${result.tables} tables restored with ${keys.length} foreign keys; ${ok ? "every table matches" : `differences in ${result.mismatched.join(", ")}`}.`);
} finally {
  if (client._connected) { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {}); await client.end(); }
  await fs.rm(file, { force: true });
}
process.exit(ok ? 0 : 1);
