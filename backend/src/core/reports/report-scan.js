import { Prisma } from "@prisma/client";
import { sqlTime } from "../../database/prisma/sql-time.js";
import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { normalizeBillingMetadata } from "../billing/billing-metadata.utils.js";
import { billFromSql, billOutletSql } from "../billing/bill-analytics.sql.js";
import { DEFAULT_TIMEZONE, addDays, isValidTimezone, localDayBounds, todayLocal } from "../../shared/utils/business-time.js";

// Reports read bills in batches and fold each batch into running totals, so memory stays flat whatever the number
// of bills, and no query carries more than BATCH ids (PostgreSQL refuses more than 32,767 parameters).

export const BATCH = 5000;
export const MAX_REPORT_DAYS = 366;
// Reports read straight from bills (guest analytics, invoice-by-invoice GST) cover at most a quarter per request.
export const MAX_DETAIL_DAYS = 92;
export const DEFAULT_REPORT_DAYS = 30;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeBill = (bill) => ({
  ...normalizeBillingMetadata(bill.metadata || {}),
  metadata: bill.metadata || {},
  id: bill.id,
  invoice_number: bill.invoiceNumber,
  customer_name: bill.customerName,
  subtotal: bill.subtotal,
  tax: bill.tax,
  total: bill.total,
  status: bill.status,
  order: bill.order || null,
  created_at: bill.createdAt.toISOString(),
  updated_at: bill.updatedAt.toISOString(),
  items: bill.items || [],
});

/** Validated local-day range. No dates means the last 30 days; a range may cover at most 366 days. */
export function reportRange({ from, to } = {}, timezone = DEFAULT_TIMEZONE, maxDays = MAX_REPORT_DAYS) {
  for (const date of [from, to]) {
    if (date != null && date !== "" && (typeof date !== "string" || !DATE.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      throw createHttpError({ statusCode: 400, message: "Report dates must be valid YYYY-MM-DD dates" });
    }
  }
  const end = to || todayLocal(timezone);
  const start = from || (to ? to : addDays(end, -(DEFAULT_REPORT_DAYS - 1)));
  if (start > end) throw createHttpError({ statusCode: 400, message: "Report start date must not follow end date" });
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  if (days > maxDays) throw createHttpError({ statusCode: 400, code: "REPORT_RANGE_TOO_LONG", message: maxDays === MAX_REPORT_DAYS ? `Choose at most ${maxDays} days per report. Export longer periods one year at a time.` : `Choose at most ${maxDays} days for this report (for example one quarter at a time).` });
  return { from: start, to: end, days, defaulted: !from && !to, bounds: localDayBounds({ from: start, to: end }, timezone) };
}

export const businessTimezone = (profile) => (isValidTimezone(profile?.timezone) ? profile.timezone : DEFAULT_TIMEZONE);

/**
 * Calls onBatch(bills) for every bill of the business created in bounds (optionally one outlet), oldest first,
 * BATCH bills at a time with their lines and order outlet. Returns the number of bills read.
 */
export async function scanBills({ businessId, bounds = {}, outletId = null }, onBatch) {
  let cursor = null, count = 0;
  for (;;) {
    const rows = await prisma.$queryRaw(Prisma.sql`SELECT b.id, b."createdAt", o."outletId" AS order_outlet_id FROM ${billFromSql}
      WHERE b."businessId" = ${businessId}
      ${bounds.gte ? Prisma.sql`AND b."createdAt" >= ${sqlTime(bounds.gte)}` : Prisma.empty}
      ${bounds.lt ? Prisma.sql`AND b."createdAt" < ${sqlTime(bounds.lt)}` : Prisma.empty}
      ${outletId ? Prisma.sql`AND ${billOutletSql} = ${outletId}` : Prisma.empty}
      ${cursor ? Prisma.sql`AND (b."createdAt", b.id) > (${sqlTime(cursor.createdAt)}, ${cursor.id})` : Prisma.empty}
      ORDER BY b."createdAt", b.id LIMIT ${BATCH}`);
    if (!rows.length) return count;
    // Bills and their lines as two plain queries joined here: Prisma's nested include was 2.5x slower.
    const ids = rows.map((row) => row.id);
    const [bills, lines] = await Promise.all([
      prisma.bill.findMany({ where: { businessId, id: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.billItem.findMany({ where: { billId: { in: ids } } }),
    ]);
    const linesByBill = new Map();
    for (const line of lines) { const list = linesByBill.get(line.billId); if (list) list.push(line); else linesByBill.set(line.billId, [line]); }
    const orderOutlet = new Map(rows.map((row) => [row.id, row.order_outlet_id]));
    await onBatch(bills.map((bill) => normalizeBill({ ...bill, items: linesByBill.get(bill.id) || [], order: bill.orderId ? { outletId: orderOutlet.get(bill.id) ?? null } : null })));
    count += rows.length;
    cursor = rows.at(-1);
    if (rows.length < BATCH) return count;
  }
}
