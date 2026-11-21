import "../src/config/env.js";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL);
const preflight = new pg.Client({ connectionString: process.env.DATABASE_URL });
await preflight.connect();
try {
  const { rows: [{ safe }] } = await preflight.query(`SELECT bool_and(
    NOT c.relrowsecurity OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) OR
    (pg_has_role(current_user, c.relowner, 'MEMBER') AND EXISTS (
      SELECT 1 FROM pg_policy p, unnest(p.polroles) r WHERE p.polrelid=c.oid AND p.polname='pos_system'
      AND pg_get_expr(p.polqual,p.polrelid)='true' AND r<>0 AND pg_has_role(current_user,r,'MEMBER')))
    ) AS safe FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'`);
  if (!safe) throw new Error("Backup requires an owner/administrator with verified unrestricted policies; refusing a potentially partial RLS backup");
} finally { await preflight.end(); }
const directory = fileURLToPath(new URL("../data/backups/", import.meta.url));
await mkdir(directory, { recursive: true });
const output = path.join(directory, `before-rls-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.dump`);
const binary = path.join(process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin", process.platform === "win32" ? "pg_dump.exe" : "pg_dump");
await new Promise((resolve, reject) => {
  const child = spawn(binary, ["--format=custom", "--enable-row-security", "--file", output, "--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username), "--dbname", url.pathname.slice(1), "--no-password"], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Backup failed (${code}); do not apply the migration`)));
});
console.log(`PostgreSQL backup saved outside Git: ${output}`);
