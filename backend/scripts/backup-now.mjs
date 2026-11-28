// Takes one off-site backup now (same steps as the nightly run): node scripts/backup-now.mjs
import "../src/config/env.js";
import { backupService } from "../src/core/backup/backup.service.js";
import prisma from "../src/database/prisma/client.js";

const result = await backupService.run({ trigger: "manual (command line)" });
console.log(result.ok
  ? `Backup ${result.name} stored and verified: ${(result.bytes / 1048576).toFixed(1)} MB, ${result.rows} rows, ${result.pruned} old backup(s) removed.`
  : result.reason === "not_configured" ? `Backups are not set up. Missing: ${result.missing.join(", ")}` : `Backup failed: ${result.error}`);
await prisma.$disconnect();
process.exit(result.ok ? 0 : 1);
