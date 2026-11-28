import { Prisma } from "@prisma/client";
import { sqlTime } from "../../../database/prisma/sql-time.js";
import prisma from "../../../database/prisma/client.js";
import { analyticsRange } from "../qr-ordering/qr-service-analytics.js";
import { tableOutletMap } from "../qr-ordering/table-outlet.js";

// Per-code performance for a date range. Sources: table scans (TableQrScanEvent), smart-code scans (QrLinkScan),
// QR orders (Order, channel "qr"). An order counts once the restaurant approved it and it was not cancelled or
// rejected; its value is the order total. Conversion = approved orders / scans of the same table code.

const TIMEZONE = "Asia/Kolkata";
const DROPPED = new Set(["cancelled", "qr_rejected", "rejected", "void"]);
const counted = (order) => order.metadata?.approval_status === "approved" && !DROPPED.has(order.status);
const round = (value) => Math.round(value * 100) / 100;

export async function qrInsights({ businessId, outletIds, query = {} }) {
  const range = analyticsRange(query), window = { gte: range.start, lt: range.end };
  const codes = await prisma.tableQrCode.findMany({ where: { businessId }, include: { table: { select: { id: true, name: true, meta: true, area: { select: { name: true } } } } } });
  const outletOf = await tableOutletMap({ businessId, tables: codes.map((code) => code.table) });
  const tables = codes.filter((code) => !outletIds || outletIds.includes(outletOf.get(code.tableId)));
  const tableIds = tables.map((code) => code.tableId);
  const links = (await prisma.qrLink.findMany({ where: { businessId } })).filter((link) => !outletIds || (link.outletId && outletIds.includes(link.outletId)));
  const linkIds = links.map((link) => link.id);

  const [tableScans, orders, linkScans, linkVisitors, hourRows] = await Promise.all([
    prisma.tableQrScanEvent.groupBy({ by: ["tableId"], where: { businessId, scannedAt: window, tableId: { in: tableIds } }, _count: { _all: true } }),
    prisma.order.findMany({ where: { businessId, channel: "qr", createdAt: window, ...(outletIds ? { outletId: { in: outletIds } } : {}) }, select: { total: true, status: true, metadata: true } }),
    prisma.qrLinkScan.groupBy({ by: ["qrLinkId"], where: { businessId, scannedAt: window, qrLinkId: { in: linkIds } }, _count: { _all: true } }),
    prisma.qrLinkScan.groupBy({ by: ["qrLinkId", "ipHash"], where: { businessId, scannedAt: window, qrLinkId: { in: linkIds }, ipHash: { not: null } } }),
    prisma.$queryRaw`
      SELECT hour, SUM(scans)::int AS scans FROM (
        SELECT EXTRACT(HOUR FROM ("scannedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TIMEZONE}))::int AS hour, COUNT(*) AS scans
          FROM "TableQrScanEvent" WHERE "businessId" = ${businessId} AND "scannedAt" >= ${sqlTime(range.start)} AND "scannedAt" < ${sqlTime(range.end)}
          AND "tableId" IN (${tableIds.length ? Prisma.join(tableIds) : ""}) GROUP BY 1
        UNION ALL
        SELECT EXTRACT(HOUR FROM ("scannedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TIMEZONE}))::int AS hour, COUNT(*) AS scans
          FROM "QrLinkScan" WHERE "businessId" = ${businessId} AND "scannedAt" >= ${sqlTime(range.start)} AND "scannedAt" < ${sqlTime(range.end)}
          AND "qrLinkId" IN (${linkIds.length ? Prisma.join(linkIds) : ""}) GROUP BY 1
      ) hours GROUP BY hour ORDER BY hour`,
  ]);

  const scansByTable = new Map(tableScans.map((row) => [row.tableId, row._count._all]));
  const ordersByTable = new Map();
  for (const order of orders.filter(counted)) {
    const row = ordersByTable.get(order.metadata?.table_id) || { orders: 0, value: 0 };
    row.orders += 1; row.value += Number(order.total);
    ordersByTable.set(order.metadata?.table_id, row);
  }
  const tableRows = tables.map((code) => {
    const scans = scansByTable.get(code.tableId) || 0, sold = ordersByTable.get(code.tableId) || { orders: 0, value: 0 };
    return { table_id: code.tableId, name: code.table.name, area_name: code.table.area?.name || null, active: code.active, scans, orders: sold.orders, order_value: round(sold.value),
      conversion_percent: scans ? Math.round((sold.orders / scans) * 1000) / 10 : null };
  }).sort((a, b) => b.scans - a.scans || b.orders - a.orders || a.name.localeCompare(b.name));

  const scansByLink = new Map(linkScans.map((row) => [row.qrLinkId, row._count._all]));
  const visitorsByLink = new Map();
  for (const row of linkVisitors) visitorsByLink.set(row.qrLinkId, (visitorsByLink.get(row.qrLinkId) || 0) + 1);
  const linkRows = links.map((link) => ({ id: link.id, name: link.name, kind: link.kind, active: link.active, scans: scansByLink.get(link.id) || 0, visitors: visitorsByLink.get(link.id) || 0 }))
    .sort((a, b) => b.scans - a.scans || a.name.localeCompare(b.name));

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, scans: 0 }));
  for (const row of hourRows) hours[Number(row.hour)].scans = Number(row.scans);
  const tableScanTotal = tableRows.reduce((sum, row) => sum + row.scans, 0);
  const approved = tableRows.reduce((sum, row) => sum + row.orders, 0);
  return {
    range: { from: range.from, to: range.to, timezone: TIMEZONE },
    totals: {
      table_scans: tableScanTotal, smart_code_scans: linkRows.reduce((sum, row) => sum + row.scans, 0),
      approved_orders: approved, order_value: round(tableRows.reduce((sum, row) => sum + row.order_value, 0)),
      conversion_percent: tableScanTotal ? Math.round((approved / tableScanTotal) * 1000) / 10 : null,
    },
    tables: tableRows, links: linkRows, hours,
    definitions: {
      approved_orders: "QR orders the restaurant approved, excluding cancelled or rejected ones, placed from a table code in this range.",
      conversion_percent: "Approved orders divided by scans of the same table code. Several scans by one party lower it.",
      visitors: "Different devices (network addresses) that opened the smart code.",
    },
  };
}
