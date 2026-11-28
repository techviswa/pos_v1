// Restores a backup into an EMPTY database that already has the same migrations applied.
//   node scripts/backup-restore.mjs --list
//   node scripts/backup-restore.mjs --name 2026-11-28T21-30-00Z.posbak --target "<empty database URL>"
//   node scripts/backup-restore.mjs --file ./backup.posbak --target "<empty database URL>"
// Prepare the target first: DATABASE_URL="<target>" npx prisma migrate deploy (in backend/).
// The encryption key is read from BACKUP_ENCRYPTION_KEY. Nothing is written unless the target is empty.
import "../src/config/env.js";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createBackupStorage, missingBackupSettings } from "../src/core/backup/backup-storage.js";
import { restoreBackup, verifyBackup } from "../src/core/backup/backup-archive.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]?.startsWith("--") ? true : all[index + 1] ?? true]] : pairs), []));
const secret = process.env.BACKUP_ENCRYPTION_KEY;
if (args.list) {
  if (missingBackupSettings().length) throw new Error(`Storage is not configured: ${missingBackupSettings().join(", ")}`);
  for (const item of (await createBackupStorage().list()).sort((a, b) => a.name.localeCompare(b.name))) console.log(`${item.name}\t${(item.bytes / 1048576).toFixed(1)} MB`);
  process.exit(0);
}
if (!args.target || (!args.name && !args.file)) { console.log("Usage: --list | (--name <stored backup> | --file <path>) --target <empty database URL>"); process.exit(1); }
if (args.target === process.env.DATABASE_URL) throw new Error("Refusing to restore over the live database. Use a new, empty database.");
let file = args.file;
if (args.name) { file = path.join(os.tmpdir(), `restore-${Date.now()}.posbak`); await createBackupStorage().download(args.name, file); }
try {
  const check = await verifyBackup({ filePath: file, secret });
  if (!check.ok) throw new Error(`The backup failed verification: ${check.problems.join("; ")}`);
  console.log(`Backup from ${check.header.created_at} verified (${check.rows} rows). Restoring...`);
  const result = await restoreBackup({ filePath: file, secret, connectionString: args.target });
  console.log(result.ok ? `Restored ${result.rows} rows into ${result.tables} tables; every table matches the backup.` : `Restored, but these tables differ: ${result.mismatched.join(", ")}`);
  process.exit(result.ok ? 0 : 1);
} finally { if (args.name) await fs.rm(file, { force: true }); }
