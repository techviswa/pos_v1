import { Prisma } from "@prisma/client";
import { sqlTime } from "../../database/prisma/sql-time.js";
import prisma from "../../database/prisma/client.js";

// Recent stock-movement totals per ingredient, summed in PostgreSQL rather than loading every movement.
// outletIds null = central stock (movements without an outlet); otherwise those outlets' movements.
// Returns Map(itemId -> { consumed, consumption_movements, wastage, pilferage }), quantities as positive numbers.
export async function recentMovementTotals({ businessId, since, outletIds = null }) {
  if (outletIds && !outletIds.length) return new Map();
  const rows = await prisma.$queryRaw(Prisma.sql`SELECT m."inventoryItemId" AS id, m."movementType" AS type,
      SUM(ABS(m.quantity))::float8 AS quantity, COUNT(*)::int AS movements
    FROM "InventoryMovement" m
    WHERE m."businessId" = ${businessId} AND m."createdAt" >= ${sqlTime(since)}
      AND ${outletIds ? Prisma.sql`m."outletId" IN (${Prisma.join(outletIds)})` : Prisma.sql`m."outletId" IS NULL`}
      AND (m."movementType" IN ('wastage', 'pilferage') OR (m."movementType" IN ('consumption', 'bill_deduction') AND m.quantity < 0))
    GROUP BY 1, 2`);
  const totals = new Map();
  for (const row of rows) {
    const entry = totals.get(row.id) || { consumed: 0, consumption_movements: 0, wastage: 0, pilferage: 0 };
    if (row.type === "wastage") entry.wastage += row.quantity;
    else if (row.type === "pilferage") entry.pilferage += row.quantity;
    else { entry.consumed += row.quantity; entry.consumption_movements += row.movements; }
    totals.set(row.id, entry);
  }
  return totals;
}
