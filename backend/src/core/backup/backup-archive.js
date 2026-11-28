import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import readline from "node:readline";
import pg from "pg";

// A backup is one file: "POSBAK1" + IV (12 bytes) + AES-256-GCM ciphertext of gzip(NDJSON) + GCM tag (16 bytes).
// NDJSON lines: a header (format, time, migrations, table order), then {"t": table, "r": row} for every row (tables
// in foreign-key order, parents first), then a footer with the row count and SHA-256 of each table's rows.
// Rows are read inside one REPEATABLE READ transaction, so the file is one consistent moment of the database.

const MAGIC = Buffer.from("POSBAK1");
const IV_BYTES = 12, TAG_BYTES = 16, BATCH = 5000, INSERT_BATCH = 500;
export const FORMAT = "pos-backup", VERSION = 1;
const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;

/** 32-byte key from the secret (any long random string, e.g. Render's generated value). */
export const backupKey = (secret) => {
  if (!secret || String(secret).length < 32) throw new Error("BACKUP_ENCRYPTION_KEY must be at least 32 characters");
  return scryptSync(String(secret), "pos-backup-v1", 32);
};

async function connect(connectionString) {
  const client = new pg.Client({ connectionString, application_name: "pos-backup" });
  await client.connect();
  return client;
}

/** Tables of a schema with their primary key columns, parents before children (fails on a foreign-key cycle). */
export async function tablePlan(client, schema = "public") {
  const { rows: tables } = await client.query(`SELECT c.relname AS name, array_agg(a.attname::text ORDER BY array_position(i.indkey, a.attnum)) AS pk
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' GROUP BY c.relname`, [schema]);
  const { rows: edges } = await client.query(`SELECT cl.relname AS child, pr.relname AS parent FROM pg_constraint k
    JOIN pg_class cl ON cl.oid = k.conrelid JOIN pg_class pr ON pr.oid = k.confrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE k.contype = 'f' AND n.nspname = $1 AND k.conrelid <> k.confrelid`, [schema]);
  const names = new Set(tables.map((table) => table.name));
  const parents = new Map(tables.map((table) => [table.name, new Set()]));
  for (const edge of edges) if (names.has(edge.child) && names.has(edge.parent)) parents.get(edge.child).add(edge.parent);
  const order = [], done = new Set();
  while (order.length < tables.length) {
    const ready = [...names].filter((name) => !done.has(name) && [...parents.get(name)].every((parent) => done.has(parent))).sort();
    if (!ready.length) throw new Error("Foreign keys form a cycle; the backup order cannot be determined");
    for (const name of ready) { order.push(name); done.add(name); }
  }
  const pk = new Map(tables.map((table) => [table.name, table.pk]));
  return order.map((name) => ({ name, pk: pk.get(name) }));
}

/** Refuses a connection that might not see every business's rows (row-level security). */
async function assertSeesEverything(client) {
  const { rows: [{ safe }] } = await client.query(`SELECT bool_and(
      NOT c.relrowsecurity OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) OR
      EXISTS (SELECT 1 FROM pg_policy p, unnest(p.polroles) r WHERE p.polrelid = c.oid AND p.polname = 'pos_system'
        AND pg_get_expr(p.polqual, p.polrelid) = 'true' AND r <> 0 AND pg_has_role(current_user, r, 'MEMBER'))
    ) AS safe FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`);
  if (!safe) throw new Error("The backup connection cannot see every business (row-level security); use the system/owner database URL");
}

/**
 * Writes an encrypted backup of the public schema to filePath.
 * Returns { tables: {name: {rows, sha256}}, migrations, bytes, sha256 (of the file), created_at }.
 */
export async function writeBackup({ connectionString, filePath, secret, now = new Date() }) {
  const key = backupKey(secret), iv = randomBytes(IV_BYTES);
  const client = await connect(connectionString);
  const summary = { tables: {}, migrations: [], created_at: now.toISOString() };
  try {
    await assertSeesEverything(client);
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const plan = await tablePlan(client);
    summary.migrations = (await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`)).rows.map((row) => row.migration_name);
    async function* lines() {
      yield `${JSON.stringify({ format: FORMAT, version: VERSION, created_at: summary.created_at, migrations: summary.migrations, tables: plan.map((table) => table.name) })}\n`;
      for (const table of plan) {
        const hash = createHash("sha256");
        let rows = 0, cursor = null;
        const keys = table.pk.map(quote).join(", ");
        for (;;) {
          const where = cursor ? `WHERE (${keys}) > (${table.pk.map((_, index) => `$${index + 1}`).join(", ")})` : "";
          const result = await client.query(`SELECT row_to_json(t)::text AS j, ${table.pk.map((column, index) => `${quote(column)} AS k${index}`).join(", ")}
            FROM ${quote(table.name)} t ${where} ORDER BY ${keys} LIMIT ${BATCH}`, cursor || []);
          let chunk = "";
          for (const row of result.rows) { hash.update(row.j).update("\n"); chunk += `{"t":${JSON.stringify(table.name)},"r":${row.j}}\n`; }
          rows += result.rows.length;
          if (chunk) yield chunk;
          if (result.rows.length < BATCH) break;
          const last = result.rows.at(-1);
          cursor = table.pk.map((_, index) => last[`k${index}`]);
        }
        summary.tables[table.name] = { rows, sha256: hash.digest("hex") };
      }
      yield `${JSON.stringify({ end: true, tables: summary.tables })}\n`;
    }
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const fileHash = createHash("sha256");
    const out = createWriteStream(filePath, { mode: 0o600 });
    out.write(Buffer.concat([MAGIC, iv])); fileHash.update(Buffer.concat([MAGIC, iv]));
    const hashing = new Transform({ transform(chunk, _encoding, done) { fileHash.update(chunk); done(null, chunk); } });
    await pipeline(Readable.from(lines()), createGzip({ level: 6 }), cipher, hashing, out, { end: false });
    const tag = cipher.getAuthTag();
    fileHash.update(tag);
    await new Promise((resolve, reject) => out.end(tag, (error) => (error ? reject(error) : resolve())));
    await client.query("COMMIT");
    summary.bytes = (await fs.stat(filePath)).size;
    summary.sha256 = fileHash.digest("hex");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await fs.rm(filePath, { force: true }).catch(() => {});
    throw error;
  } finally { await client.end(); }
}

/** Decrypts and reads a backup file line by line: onLine(object). Throws if the file was altered or the key is wrong. */
export async function readBackup({ filePath, secret }, onLine) {
  const key = backupKey(secret);
  const stat = await fs.stat(filePath);
  if (stat.size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("Not a POS backup file");
  const handle = await fs.open(filePath, "r");
  const head = Buffer.alloc(MAGIC.length + IV_BYTES), tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(head, 0, head.length, 0);
    await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
  } finally { await handle.close(); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a POS backup file");
  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const plain = createReadStream(filePath, { start: head.length, end: stat.size - TAG_BYTES - 1 }).pipe(decipher).pipe(createGunzip());
  const errors = [];
  for (const stream of [decipher, plain]) stream.on("error", (error) => errors.push(error));
  const reader = readline.createInterface({ input: plain, crlfDelay: Infinity });
  try {
    for await (const line of reader) if (line) await onLine(JSON.parse(line), line);
  } catch (error) {
    throw errors[0] ? new Error("The backup could not be decrypted (wrong key or damaged file)") : error;
  }
  if (errors.length) throw new Error("The backup could not be decrypted (wrong key or damaged file)");
}

/** Re-reads a backup and checks every table's row count and SHA-256 against its footer. */
export async function verifyBackup({ filePath, secret }) {
  let header = null, footer = null;
  const hashes = new Map(), counts = new Map();
  await readBackup({ filePath, secret }, (line, raw) => {
    if (line.format) { header = line; return; }
    if (line.end) { footer = line; return; }
    if (!hashes.has(line.t)) { hashes.set(line.t, createHash("sha256")); counts.set(line.t, 0); }
    // The row exactly as PostgreSQL wrote it: the line is {"t":"<table>","r":<row>}.
    const prefix = `{"t":${JSON.stringify(line.t)},"r":`;
    hashes.get(line.t).update(raw.slice(prefix.length, -1)).update("\n");
    counts.set(line.t, counts.get(line.t) + 1);
  });
  if (header?.format !== FORMAT || !footer) throw new Error("The backup is incomplete (missing header or footer)");
  const problems = [];
  for (const [table, expected] of Object.entries(footer.tables)) {
    const rows = counts.get(table) || 0;
    const sha256 = (hashes.get(table) || createHash("sha256")).digest("hex");
    if (rows !== expected.rows) problems.push(`${table}: ${rows} rows, expected ${expected.rows}`);
    else if (sha256 !== expected.sha256) problems.push(`${table}: contents differ from the fingerprint`);
  }
  return { ok: !problems.length, problems, header, footer, rows: [...counts.values()].reduce((sum, value) => sum + value, 0) };
}

/**
 * Restores a backup into an empty database (schema must already have the same migrations applied). schema lets a
 * drill restore into a scratch schema. Afterwards each table is re-read and compared with the backup's fingerprints.
 */
export async function restoreBackup({ filePath, secret, connectionString, schema = "public", allowNonEmpty = false }) {
  const client = await connect(connectionString);
  try {
    await client.query(`SET search_path TO ${quote(schema)}`);
    const plan = await tablePlan(client, schema);
    const planned = new Set(plan.map((table) => table.name));
    if (!allowNonEmpty) {
      for (const table of plan) {
        const { rows: [row] } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${quote(table.name)}) AS used`);
        if (row.used) throw new Error(`The target database is not empty (${table.name} has rows). Restore into a new, empty database.`);
      }
    }
    let header = null, footer = null, pending = [], pendingTable = null;
    const flush = async () => {
      if (!pending.length) return;
      await client.query(`INSERT INTO ${quote(pendingTable)} SELECT * FROM json_populate_recordset(NULL::${quote(pendingTable)}, $1::json)`, [JSON.stringify(pending)]);
      pending = [];
    };
    await client.query("BEGIN");
    await readBackup({ filePath, secret }, async (line) => {
      if (line.format) {
        header = line;
        if (schema === "public") {
          const { rows } = await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
          const applied = rows.map((row) => row.migration_name).join(",");
          if (applied !== line.migrations.join(",")) throw new Error("The target database's migrations differ from the backup's. Apply exactly the backup's migrations first.");
        }
        for (const table of line.tables) if (!planned.has(table)) throw new Error(`The target has no table ${table}`);
        return;
      }
      if (line.end) { footer = line; return; }
      if (line.t !== pendingTable || pending.length >= INSERT_BATCH) { await flush(); pendingTable = line.t; }
      pending.push(line.r);
    });
    await flush();
    if (!header || !footer) throw new Error("The backup is incomplete");
    // Counters (e.g. stock movement sequence numbers) continue after the restored rows.
    for (const table of plan) {
      const { rows: columns } = await client.query(`SELECT a.attname AS column, pg_get_serial_sequence($1, a.attname) AS seq FROM pg_attribute a
        WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`, [`${quote(schema)}.${quote(table.name)}`]);
      for (const column of columns.filter((row) => row.seq)) {
        await client.query(`SELECT setval($1, COALESCE((SELECT MAX(${quote(column.column)}) FROM ${quote(table.name)}), 0) + 1, false)`, [column.seq]);
      }
    }
    await client.query("COMMIT");
    // Proof: every table read back from the database matches the backup's fingerprint.
    const mismatched = [];
    for (const table of plan) {
      const expected = footer.tables[table.name] || { rows: 0, sha256: createHash("sha256").digest("hex") };
      const hash = createHash("sha256");
      let rows = 0, cursor = null;
      const keys = table.pk.map(quote).join(", ");
      for (;;) {
        const where = cursor ? `WHERE (${keys}) > (${table.pk.map((_, index) => `$${index + 1}`).join(", ")})` : "";
        const result = await client.query(`SELECT row_to_json(t)::text AS j, ${table.pk.map((column, index) => `${quote(column)} AS k${index}`).join(", ")} FROM ${quote(table.name)} t ${where} ORDER BY ${keys} LIMIT ${BATCH}`, cursor || []);
        for (const row of result.rows) hash.update(row.j).update("\n");
        rows += result.rows.length;
        if (result.rows.length < BATCH) break;
        cursor = table.pk.map((_, index) => result.rows.at(-1)[`k${index}`]);
      }
      if (rows !== expected.rows || hash.digest("hex") !== expected.sha256) mismatched.push(table.name);
    }
    return { ok: !mismatched.length, mismatched, tables: plan.length, rows: Object.values(footer.tables).reduce((sum, table) => sum + table.rows, 0), created_at: header.created_at };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { await client.end(); }
}
