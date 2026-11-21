// One-time, explicitly approved local Windows administrator recovery.
// Run elevated; the temporary authentication exception is restored in finally.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

if (!process.argv.includes("--approved-local-recovery")) throw new Error("Explicit recovery approval required");
const serviceJson = execFileSync("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Service -Filter \"Name='postgresql-x64-18'\").PathName | ConvertTo-Json"], { encoding: "utf8", windowsHide: true });
const servicePath = JSON.parse(serviceJson);
const directory = servicePath.match(/-D\s+"([^"]+)"/)?.[1];
if (!directory) throw new Error("Cannot identify PostgreSQL data directory");
const hba = path.join(directory, "pg_hba.conf");
const original = await readFile(hba);
const backup = `${hba}.before-pos-recovery-${Date.now()}`;
await copyFile(hba, backup);
const reload = () => execFileSync("powershell.exe", ["-NoProfile", "-Command", "Restart-Service -Name postgresql-x64-18 -ErrorAction Stop"], { stdio: "pipe", windowsHide: true });
const password = randomBytes(36).toString("base64url");
const envFile = new URL("../.env", import.meta.url);
const existing = await readFile(envFile, "utf8");
const adminUrl = new URL("postgresql://postgres@localhost:5432/viswa_pos?schema=public");
adminUrl.password = password;
let restored = false;
try {
  // Narrow exception: only postgres, only this database, only IPv4 loopback.
  await writeFile(hba, Buffer.concat([Buffer.from("host viswa_pos postgres 127.0.0.1/32 trust\r\n"), original]));
  reload();
  const admin = new pg.Client({ host: "127.0.0.1", port: 5432, database: "viswa_pos", user: "postgres", connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    const { rows: [actor] } = await admin.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user");
    if (!actor?.rolsuper) throw new Error("Expected PostgreSQL administrator");
    await admin.query(`ALTER ROLE postgres PASSWORD '${password}'`);
    const line = `RLS_ADMIN_DATABASE_URL=${JSON.stringify(adminUrl.toString())}`;
    await writeFile(envFile, /^RLS_ADMIN_DATABASE_URL=.*$/m.test(existing) ? existing.replace(/^RLS_ADMIN_DATABASE_URL=.*$/m, line) : existing.trimEnd() + "\n" + line + "\n");
  } finally { await admin.end(); }
} finally {
  await writeFile(hba, original);
  reload();
  restored = (await readFile(hba)).equals(original);
  if (!restored) throw new Error("Authentication configuration restoration failed");
}
const verify = new pg.Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
await verify.connect();
await verify.end();
console.log("Administrator password recovered and saved only in ignored backend/.env. Original password authentication restored byte-for-byte; password login verified. DATABASE_URL unchanged.");
