import prisma from "../../../database/prisma/client.js";
import { createHttpError } from "../../../shared/utils/http-error.js";

// Tables belong to the business; the outlet they serve is stored in the table's meta (outlet_id).
// A business with one outlet does not have to link each table: its only open outlet serves every table.
// Without this, QR orders had no outlet, so their stock came out of the central kitchen and their cash
// went to a drawer no outlet shows.

export const assignedTableOutletId = (meta) => meta?.outlet_id || meta?.outletId || null;

const openOutlets = (client, businessId) => client.outlet.findMany({
  where: { businessId, status: "active" },
  select: { id: true },
  orderBy: { createdAt: "asc" },
  take: 2,
});

/**
 * The outlet a table serves. `ambiguous` is true when the business has several open outlets and the table is not
 * linked to one: orders from it cannot be placed, because nobody knows whose stock and cash they belong to.
 * A business without outlets keeps business-level tables (outletId null, not ambiguous).
 */
export async function resolveTableOutlet({ businessId, meta, client = prisma }) {
  const assigned = assignedTableOutletId(meta);
  if (assigned) {
    const outlet = await client.outlet.findFirst({ where: { id: assigned, businessId }, select: { id: true } });
    if (!outlet) throw createHttpError({ statusCode: 409, code: "TABLE_OUTLET_INVALID", message: "This table's outlet needs to be corrected by the restaurant" });
    return { outletId: outlet.id, ambiguous: false };
  }
  const outlets = await openOutlets(client, businessId);
  return { outletId: outlets.length === 1 ? outlets[0].id : null, ambiguous: outlets.length > 1 };
}

/** Same rule for many tables at once: tableId -> outletId (or null). */
export async function tableOutletMap({ businessId, tables, client = prisma }) {
  const outlets = await openOutlets(client, businessId);
  const fallback = outlets.length === 1 ? outlets[0].id : null;
  return new Map(tables.map((table) => [table.id, assignedTableOutletId(table.meta) || fallback]));
}
