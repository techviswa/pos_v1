import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import env from "../src/config/env.js";
import prisma from "../src/database/prisma/client.js";

const schema = `migration_verify_${randomUUID().replaceAll("-", "")}`;
const url = new URL(env.database.url);
url.searchParams.set("schema", schema);
const run = (args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", ...args], {
    cwd: new URL("../", import.meta.url), env: { ...process.env, DATABASE_URL: url.href },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("exit", (code) => resolve({ code, stdout, stderr }));
});

try {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const deploy = await run(["migrate", "deploy"]);
  if (deploy.code) throw new Error(deploy.stderr.replaceAll(url.href, "[database]"));
  const diff = await run(["migrate", "diff", "--from-url", url.href, "--to-schema-datamodel", "prisma/schema.prisma", "--script", "--exit-code"]);
  if (diff.code === 2) {
    await writeFile(new URL("../migration-history-diff.sql", import.meta.url), diff.stdout);
    throw new Error("Migration history does not reproduce the Prisma schema. Review backend/migration-history-diff.sql.");
  }
  if (diff.code) throw new Error(diff.stderr.replaceAll(url.href, "[database]"));
  console.log("All migrations deploy cleanly into an isolated schema and reproduce the Prisma schema.");
} finally {
  // This randomly named schema is created exclusively by this test; never the application schema.
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await prisma.$disconnect();
}
