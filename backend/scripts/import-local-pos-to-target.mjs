import "../src/config/env.js";
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const args = new Set(process.argv.slice(2));
const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;

const clipboardUrl = () => {
  if (process.platform !== "win32") return "";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : "";
};

const sourceUrl = String(process.env.LOCAL_SOURCE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const targetUrl = String(process.env.TARGET_DATABASE_URL || (args.has("--target-from-clipboard") ? clipboardUrl() : "")).trim();

const safeUrl = (value) => {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "[invalid URL]";
  }
};

if (!sourceUrl || !targetUrl) {
  throw new Error("A local source and target database URL are required. Copy the Render External Database URL, then run npm run import:render-data.");
}
if (sourceUrl === targetUrl || safeUrl(sourceUrl) === safeUrl(targetUrl)) {
  throw new Error("Source and target databases are the same; import refused.");
}

const source = new Client({ connectionString: sourceUrl });
const target = new Client({ connectionString: targetUrl });

const tableNames = async (client) => (await client.query(`
  SELECT c.relname AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
  ORDER BY c.relname
`)).rows.map((row) => row.name);

const rowCount = async (client, table) => Number((await client.query(`SELECT count(*)::int AS count FROM public.${quote(table)}`)).rows[0].count);

const columnNames = async (client, table) => (await client.query(`
  SELECT column_name AS name
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = $1
  ORDER BY ordinal_position
`, [table])).rows.map((row) => row.name);

const constraintState = async (client) => (await client.query(`
  SELECT c.conrelid::regclass::text AS table_name, c.conname,
         c.condeferrable, c.condeferred
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE c.contype = 'f' AND n.nspname = 'public'
  ORDER BY c.conrelid::regclass::text, c.conname
`)).rows;

const rlsState = async (client) => (await client.query(`
  SELECT c.relname AS table_name, c.relforcerowsecurity AS forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
  ORDER BY c.relname
`)).rows;

const insertTable = async (table, columns) => {
  const rows = (await source.query(`SELECT * FROM public.${quote(table)}`)).rows;
  if (!rows.length) return 0;
  const columnSql = columns.map(quote).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `INSERT INTO public.${quote(table)} (${columnSql}) VALUES (${placeholders})`;
  for (const row of rows) await target.query(sql, columns.map((column) => row[column]));
  return rows.length;
};

await Promise.all([source.connect(), target.connect()]);
try {
  const [sourceTables, targetTables, sourceBusinesses, targetBusinesses] = await Promise.all([
    tableNames(source), tableNames(target), rowCount(source, "Business"), rowCount(target, "Business"),
  ]);
  if (!sourceBusinesses) throw new Error("The local source has no businesses; import refused.");
  if (targetBusinesses) throw new Error("The Render target already contains business data; import refused to prevent overwriting it.");
  const missing = sourceTables.filter((table) => !targetTables.includes(table));
  if (missing.length) throw new Error(`Render schema is missing tables: ${missing.join(", ")}`);

  const [constraints, rls] = await Promise.all([constraintState(target), rlsState(target)]);
  const columns = new Map(await Promise.all(sourceTables.map(async (table) => [table, await columnNames(source, table)])));
  const counts = new Map();

  await target.query("BEGIN");
  try {
    await target.query("SET LOCAL lock_timeout = '30s'");
    await target.query("SET LOCAL statement_timeout = '10min'");
    for (const item of constraints) {
      await target.query(`ALTER TABLE ${item.table_name} ALTER CONSTRAINT ${quote(item.conname)} DEFERRABLE INITIALLY DEFERRED`);
    }
    for (const item of rls) await target.query(`ALTER TABLE public.${quote(item.table_name)} NO FORCE ROW LEVEL SECURITY`);
    await target.query(`TRUNCATE TABLE ${targetTables.map((table) => `public.${quote(table)}`).join(", ")} RESTART IDENTITY CASCADE`);
    for (const table of sourceTables) counts.set(table, await insertTable(table, columns.get(table)));

    for (const table of sourceTables) {
      const actual = await rowCount(target, table);
      if (actual !== counts.get(table)) throw new Error(`Row count mismatch for ${table}: expected ${counts.get(table)}, got ${actual}`);
    }
    for (const item of rls) {
      await target.query(`ALTER TABLE public.${quote(item.table_name)} ${item.forced ? "FORCE" : "NO FORCE"} ROW LEVEL SECURITY`);
    }
    for (const item of constraints) {
      const mode = item.condeferrable
        ? `DEFERRABLE INITIALLY ${item.condeferred ? "DEFERRED" : "IMMEDIATE"}`
        : "NOT DEFERRABLE";
      await target.query(`ALTER TABLE ${item.table_name} ALTER CONSTRAINT ${quote(item.conname)} ${mode}`);
    }
    await target.query("COMMIT");
  } catch (error) {
    await target.query("ROLLBACK").catch(() => {});
    throw error;
  }

  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  console.log(JSON.stringify({ status: "imported", tables: sourceTables.length, records: total, businesses: sourceBusinesses }));
} finally {
  await Promise.allSettled([source.end(), target.end()]);
}
