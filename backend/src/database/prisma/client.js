import "../../config/env.js";
import { Prisma, PrismaClient } from "@prisma/client";
import { createTenantGuard } from "./tenant-guard.js";
import { createRlsRuntime } from "./rls-runtime.js";
import { verifyRlsConnection } from "./rls-health.js";

const globalForPrisma = globalThis;

/**
 * Money columns are exact DECIMALs in PostgreSQL (no binary floating-point drift is stored). Prisma returns those
 * as Decimal objects; the application works with JS numbers that it rounds to cents at every boundary, so results
 * are converted back here, in one place, instead of in every service. Writes accept plain numbers and PostgreSQL
 * rounds them to the column scale.
 */
export const toPlainNumbers = (value) => {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (Prisma.Decimal.isDecimal(value)) return value.toNumber();
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) value[index] = toPlainNumbers(value[index]);
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  // Only plain row objects are walked; Dates, Buffers and other class instances are returned untouched.
  if (prototype !== Object.prototype && prototype !== null) return value;
  for (const key of Object.keys(value)) value[key] = toPlainNumbers(value[key]);
  return value;
};

const createClient = () => {
  const raw = new PrismaClient({
    ...(process.env.SYSTEM_DATABASE_URL ? { datasourceUrl: process.env.SYSTEM_DATABASE_URL } : {}),
    log: ["error", "warn"],
  });
  // Reference checks must not wait on the same pool occupied by interactive
  // transactions. Use a separate, capped pool to the same database (not a new URL
  // in environment/config), and close both pools through the exported client.
  const referenceUrl = new URL(process.env.SYSTEM_DATABASE_URL || process.env.DATABASE_URL);
  referenceUrl.searchParams.set("connection_limit", "2");
  const references = new PrismaClient({ datasourceUrl: referenceUrl.toString(), log: ["error", "warn"] }).$extends({
    query: { async $allOperations({ args, query }) { return toPlainNumbers(await query(args)); } },
  });
  const guard = createTenantGuard(references);
  const tenant = process.env.TENANT_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TENANT_DATABASE_URL, log: ["error", "warn"] }) : null;
  const rls = createRlsRuntime({ system: raw, tenant, guard, convert: toPlainNumbers });
  return raw.$extends({
    name: "tenant-guard-and-decimal-as-number",
    client: {
      async $connect() {
        await raw.$connect();
        if (process.env.SYSTEM_DATABASE_URL) await verifyRlsConnection(raw, { system: true });
        if (tenant) { await tenant.$connect(); await verifyRlsConnection(tenant); }
        else if (process.env.NODE_ENV === "production") throw new Error("TENANT_DATABASE_URL is required in production");
      },
      async $disconnect() { await Promise.all([raw.$disconnect(), references.$disconnect(), tenant?.$disconnect()]); },
      $transaction(work, options) { return rls.transaction(work, options); },
    },
    query: {
      async $allOperations(operation) {
        return toPlainNumbers(await guard({ ...operation, query: (args) => rls.execute({ ...operation, args }) }));
      },
    },
  });
};

export const prisma = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
