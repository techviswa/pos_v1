import "../../config/env.js";
import { Prisma, PrismaClient } from "@prisma/client";

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

const createClient = () =>
  new PrismaClient({
    log: ["error", "warn"],
  }).$extends({
    name: "decimal-as-number",
    query: {
      async $allOperations({ args, query }) {
        return toPlainNumbers(await query(args));
      },
    },
  });

export const prisma = globalForPrisma.prisma || createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
