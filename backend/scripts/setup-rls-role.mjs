import "../src/config/env.js";
import pg from "pg";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export const setupRlsRole = async ({ adminUrl, systemUrl, roleName = "pos_tenant_runtime", systemRoleName = "pos_system_runtime", password = randomBytes(36).toString("base64url") }) => {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(roleName)) throw new Error("Invalid runtime role name");
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(systemRoleName) || systemRoleName === roleName) throw new Error("Invalid system runtime role name");
  const systemPassword = randomBytes(36).toString("base64url");
  const admin = new pg.Client({ connectionString: adminUrl });
  const system = new URL(systemUrl), administrator = new URL(adminUrl);
  if (system.hostname !== administrator.hostname || (system.port || "5432") !== (administrator.port || "5432") || system.pathname !== administrator.pathname) throw new Error("Administrator and system URLs must target the same database");
  await admin.connect();
  try {
    const { rows: [actor] } = await admin.query("SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname=current_user");
    if (!actor.rolsuper && !actor.rolcreaterole) throw new Error("PostgreSQL administrator credentials with CREATEROLE are required; no roles or environment files changed");
    const { rows: existing } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname IN ($1, $2)", [roleName, systemRoleName]);
    if (existing.length) throw new Error("Runtime role already exists; use its existing credential or choose an unused RLS_RUNTIME_ROLE name");
    const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
    await admin.query("BEGIN");
    await admin.query(`CREATE ROLE ${quote(roleName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD '${password.replaceAll("'", "''")}'`);
    await admin.query(`CREATE ROLE ${quote(systemRoleName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD '${systemPassword}'`);
    const { rows: [{ database }] } = await admin.query("SELECT current_database() AS database");
    await admin.query(`GRANT CONNECT ON DATABASE ${quote(database)} TO ${quote(roleName)}, ${quote(systemRoleName)}`);
    await admin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await admin.query(`GRANT USAGE ON SCHEMA public, pos_security TO ${quote(roleName)}, ${quote(systemRoleName)}`);
    const tables = Prisma.dmmf.datamodel.models.map((model) => `public.${quote(model.dbName || model.name)}`).join(", ");
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tables} TO ${quote(roleName)}, ${quote(systemRoleName)}`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quote(roleName)}, ${quote(systemRoleName)}`);
    for (const model of Prisma.dmmf.datamodel.models) {
      const target = `public.${quote(model.dbName || model.name)}`;
      const { rows: [{ owner_name }] } = await admin.query("SELECT pg_get_userbyid(relowner) AS owner_name FROM pg_class WHERE oid=$1::regclass", [target]);
      await admin.query(`ALTER POLICY pos_system ON ${target} TO ${quote(owner_name)}, ${quote(systemRoleName)}`);
    }
    await admin.query("COMMIT");
    const runtime = new URL(systemUrl);
    runtime.username = roleName; runtime.password = password;
    runtime.searchParams.set("connection_limit", "8");
    const systemRuntime = new URL(systemUrl);
    systemRuntime.username = systemRoleName; systemRuntime.password = systemPassword;
    systemRuntime.searchParams.set("connection_limit", "8");
    return { tenantUrl: runtime.toString(), systemUrl: systemRuntime.toString() };
  } catch (error) { await admin.query("ROLLBACK").catch(() => {}); throw error; }
  finally { await admin.end(); }
};

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  try {
    if (!process.argv.includes("--write-local-env")) throw new Error("Use --write-local-env to save the generated runtime credential securely; no role was created.");
    const urls = await setupRlsRole({ adminUrl: process.env.RLS_ADMIN_DATABASE_URL || process.env.DATABASE_URL, systemUrl: process.env.DATABASE_URL, roleName: process.env.RLS_RUNTIME_ROLE || "pos_tenant_runtime", systemRoleName: process.env.RLS_SYSTEM_ROLE || "pos_system_runtime" });
    for (const file of [new URL("../.env", import.meta.url), new URL("../../.env", import.meta.url)]) {
      const existing = await readFile(file, "utf8");
      let updated = existing;
      for (const [key, url] of [["TENANT_DATABASE_URL", urls.tenantUrl], ["SYSTEM_DATABASE_URL", urls.systemUrl]]) {
        const line = `${key}=${JSON.stringify(url)}`;
        const pattern = new RegExp(`^${key}=.*$`, "m");
        updated = pattern.test(updated) ? updated.replace(pattern, line) : updated.trimEnd() + "\n" + line + "\n";
      }
      await writeFile(file, updated);
    }
    console.log("Separate tenant and system runtime roles created; URLs saved to ignored local environment files. DATABASE_URL unchanged.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
