import { Prisma } from "@prisma/client";

// The SQL form of bill-analytics.utils.js, for totals computed in PostgreSQL instead of loading every bill.
// Keep both in step: a bill's outlet is metadata.outlet_id, else metadata.outletId, else its order's outlet;
// revenue is the total less refunds (never below 0); void/cancelled bills and bills with no revenue do not count.
// Every fragment expects the bill as alias b and its order (LEFT JOIN) as alias o.

export const billOutletSql = Prisma.sql`COALESCE(NULLIF(b.metadata->>'outlet_id', ''), NULLIF(b.metadata->>'outletId', ''), o."outletId")`;
const refundSql = Prisma.sql`(CASE WHEN (b.metadata->>'refunded_amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (b.metadata->>'refunded_amount')::numeric ELSE 0 END)`;
export const billRevenueSql = Prisma.sql`GREATEST(0, b.total - ${refundSql})`;
export const isRevenueBillSql = Prisma.sql`(lower(b.status) NOT IN ('void', 'cancelled', 'canceled') AND ${billRevenueSql} > 0)`;
/** Tax kept after refunds, in proportion (getBillTax). */
export const billTaxSql = Prisma.sql`(CASE WHEN b.total > 0 THEN b.tax * (${billRevenueSql} / b.total) ELSE 0 END)`;
export const billFromSql = Prisma.sql`"Bill" b LEFT JOIN "Order" o ON o.id = b."orderId"`;
