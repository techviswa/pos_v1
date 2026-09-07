import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import env from "../src/config/env.js";

const database = new URL(env.database.url);
if (!["postgresql:", "postgres:"].includes(database.protocol)) throw new Error("PostgreSQL is required");
const directory = fileURLToPath(new URL("../data/backups/", import.meta.url));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const archive = join(directory, `pos-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.dump`);
const executable = (name) => {
  const installed = `C:/Program Files/PostgreSQL/18/bin/${name}.exe`;
  return process.platform === "win32" && existsSync(installed) ? installed : name;
};
// Credentials go through the child environment, never command arguments or logs.
const childEnv = { ...process.env, PGHOST: database.hostname, PGPORT: database.port || "5432",
  PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: decodeURIComponent(database.pathname.slice(1)), PGCONNECT_TIMEOUT: "15" };
if (database.searchParams.has("sslmode")) childEnv.PGSSLMODE = database.searchParams.get("sslmode");
const run = (name, args) => {
  const result = spawnSync(executable(name), args, { env: childEnv, encoding: "utf8", timeout: 300000 });
  if (result.error || result.status !== 0) {
    // Tool stderr can include connection information; do not echo it.
    throw new Error(`${name} failed (${result.error?.code || result.status}); backup is not verified`);
  }
  return result.stdout;
};
run("pg_dump", ["--no-password", "--format=custom", "--file", archive]);
if (process.platform !== "win32") chmodSync(archive, 0o600);
const contents = run("pg_restore", ["--list", archive]);
if (!contents.includes("TABLE")) throw new Error("Backup contains no table entries");
console.log(`Backup created and archive directory verified: ${archive}`);
console.log("A restore drill into an isolated database is still required before relying on this backup.");
