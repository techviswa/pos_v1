// Build a disposable PostgreSQL cluster. Copy schema only, never customer data.
// No policy, credential, or role is changed in the existing project database.
import "../src/config/env.js";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import pg from "pg";
import { setupRlsRole } from "./setup-rls-role.mjs";

const execute = promisify(execFile);
// pg_ctl's detached Windows server can retain pipe handles. Wait for controller
// exit with ignored stdio instead of execFile's pipe-close event.
const control = (args) => new Promise((resolve, reject) => {
  const child = spawn(binary("pg_ctl"), args, { windowsHide: true, stdio: "ignore" });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`pg_ctl failed (${code})`)));
});
const binary = (name) => path.join(process.env.PG_BIN || "C:/Program Files/PostgreSQL/18/bin", name + (process.platform === "win32" ? ".exe" : ""));
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "data"), { recursive: true });
const directory = await mkdtemp(path.join(root, "data", "rls-check-"));
const data = path.join(directory, "cluster");
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const source = new URL(process.env.DATABASE_URL);
const systemUrl = `postgresql://rls_test_admin@127.0.0.1:${port}/pos_rls_check`;
const runNode = (script, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script], { cwd: root, env, windowsHide: true, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
});
let started = false;
try {
  console.log("Creating disposable PostgreSQL cluster with schema only...");
  await execute(binary("initdb"), ["-D", data, "--username=rls_test_admin", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--no-locale"], { windowsHide: true });
  await control(["-D", data, "-l", path.join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  started = true;
  console.log("Disposable database started on loopback; installing policies and restricted role...");
  const admin = new pg.Client({ connectionString: systemUrl.replace("/pos_rls_check", "/postgres") });
  await admin.connect();
  await admin.query("CREATE DATABASE pos_rls_check");
  await admin.end();
  const { stdout: schema } = await execute(binary("pg_dump"), ["--schema-only", "--no-owner", "--no-privileges", "--schema=public", "-h", source.hostname, "-p", source.port || "5432", "-U", decodeURIComponent(source.username), "-d", source.pathname.slice(1)], { env: { ...process.env, PGPASSWORD: decodeURIComponent(source.password) }, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  const client = new pg.Client({ connectionString: systemUrl });
  await client.connect();
  try {
  await client.query("DROP SCHEMA public"); // only the empty disposable database
  // psql \restrict/\unrestrict guards are client commands, not SQL.
  const baseline = schema.split("\n").filter((line) => !line.startsWith("\\")).join("\n")
    // A source that already has RLS contains policies referencing its own roles.
    // Reinstall this migration under the disposable owner instead of copying
    // those role references or requiring pos_security functions from the source.
    .replace(/^CREATE POLICY pos_(?:system|tenant|catalog_read|catalog_insert|catalog_update)\b[\s\S]*?;\r?$/gm, "")
    .replace(/^CREATE TRIGGER pos_check_references\b[\s\S]*?;\r?$/gm, "")
    .replace(/^ALTER TABLE (?:ONLY )?public\.[^\r\n]+ (?:ENABLE|FORCE) ROW LEVEL SECURITY;\r?$/gm, "");
  await client.query(baseline);
  const migration = await readFile(new URL("../prisma/migrations/20261024090000_tenant_row_security/migration.sql", import.meta.url), "utf8");
  await client.query(migration);
  } finally { await client.end(); }
  const runtime = await setupRlsRole({ adminUrl: systemUrl, systemUrl });
  const env = { ...process.env, DATABASE_URL: systemUrl, SYSTEM_DATABASE_URL: runtime.systemUrl, TENANT_DATABASE_URL: runtime.tenantUrl, NODE_ENV: "test", ADMINCORE_ENABLED: "false", MARKETING_WORKER: "off", RLS_TEST_DATABASE: "1" };
  await runNode("prisma/seed.js", env);
  await runNode("scripts/rls-database-tests.mjs", env);
  if (process.argv.includes("--customer-sync")) await runNode("scripts/customer-qr-sync-tests.mjs", env);
  if (process.argv.includes("--assistance")) await runNode("scripts/table-assistance-tests.mjs", env);
  if (process.argv.includes("--checkout")) await runNode("scripts/qr-checkout-tests.mjs", env);
    if (process.argv.includes("--central")) await runNode("scripts/central-kitchen-repair-tests.mjs", env);
    if (process.argv.includes("--food")) await runNode("scripts/qr-menu-details-tests.mjs", env);
  if (process.argv.includes("--experience")) await runNode("scripts/qr-experience-tests.mjs", env);
  if (!process.argv.includes("--quick")) await runNode("scripts/deploy-check.mjs", env);
  console.log("Isolated PostgreSQL RLS check passed. Existing project database was not modified.");
} finally {
  if (started) await control(["-D", data, "-m", "fast", "-w", "stop"]);
}
