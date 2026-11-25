import prisma from "../../../database/prisma/client.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { guestProgress } from "./guest-progress.js";
import { ASSISTANCE_KINDS } from "./table-assistance.service.js";
import { reviewKey } from "./qr-experience.service.js";
import { qrBillScope } from "./qr-bill-scope.js";
import { tableOutletMap } from "./table-outlet.js";

const fail = (message) => { throw createHttpError({ statusCode: 400, message }); };
const day = (value) => new Date(value).toISOString().slice(0, 10);
export function analyticsRange(query = {}) {
  const to = query.to || day(Date.now());
  const from = query.from || (typeof to === "string" && Number.isFinite(Date.parse(to)) ? day(Date.parse(to) - 6 * 86400000) : "");
  for (const value of [from, to]) if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || day(value) !== value) fail("Use valid YYYY-MM-DD dates");
  if (from > to) fail("Start date must not follow end date");
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= 92) fail("Choose at most 92 days");
  return { from, to, start: new Date(`${from}T00:00:00Z`), end: new Date(Date.parse(`${to}T00:00:00Z`) + 86400000) };
}
const minutes = (start, end) => {
  if (!start || !end) return null;
  const value = (Date.parse(end) - Date.parse(start)) / 60000;
  return Number.isFinite(value) && value >= 0 ? value : null;
};
const median = (values) => {
  const sorted = values.filter((value) => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  return sorted.length ? Math.round((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 * 10) / 10 : null;
};
const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;

export async function qrServiceAnalytics({ businessId, outletIds, query = {} }) {
  const range = analyticsRange(query), createdAt = { gte: range.start, lt: range.end };
  const outlet = outletIds ? { outletId: { in: outletIds } } : {};
  const tables = await prisma.diningTable.findMany({ where: { businessId }, select: { id: true, meta: true } });
  const outletOf = await tableOutletMap({ businessId, tables });
  const tableIds = tables.filter((table) => !outletIds || outletIds.includes(outletOf.get(table.id))).map((table) => table.id);
  const [orders, scans, documents, feedback] = await Promise.all([
    prisma.order.findMany({ where: { businessId, channel: "qr", createdAt, ...outlet }, include: { items: true, kitchenTickets: { select: { status: true } } } }),
    prisma.tableQrScanEvent.count({ where: { businessId, scannedAt: createdAt, ...(outletIds ? { tableId: { in: tableIds } } : {}) } }),
    prisma.stateDocument.findMany({ where: { key: { startsWith: `assistance:${businessId}:` }, updatedAt: { gte: range.start } }, select: { data: true } }),
    prisma.feedback.findMany({ where: { businessId, createdAt, bill: qrBillScope(outletIds) }, include: { bill: { select: { metadata: true, order: { select: { metadata: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const requests = documents.map((doc) => doc.data).filter((row) => row.business_id === businessId && Date.parse(row.created_at) >= range.start.getTime() && Date.parse(row.created_at) < range.end.getTime() && (!outletIds || outletIds.includes(row.outlet_id)));
  const [sessions, details] = await Promise.all([
    prisma.tableSession.findMany({ where: { businessId, id: { in: [...new Set(requests.map((row) => row.session_id))] } }, select: { id: true, status: true, openedAt: true } }),
    prisma.stateDocument.findMany({ where: { key: { in: feedback.map((row) => reviewKey(businessId, row.id)) } } }),
  ]);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const detailByKey = new Map(details.map((row) => [row.key, row.data]));
  const daily = [];
  for (let time = range.start.getTime(); time < range.end.getTime(); time += 86400000) daily.push({ date: day(time), orders: 0, requests: 0 });
  const dailyByDate = new Map(daily.map((row) => [row.date, row]));
  const pipeline = { pending: 0, accepted: 0, preparing: 0, ready: 0, completed: 0, rejected: 0, cancelled: 0 };
  const approvalTimes = [], kitchenTimes = [], offers = new Map();
  let lateKitchen = 0;
  for (const order of orders) {
    const status = guestProgress(order, order.kitchenTickets[0]?.status);
    pipeline[status] = (pipeline[status] || 0) + 1;
    dailyByDate.get(day(order.createdAt)).orders++;
    const metadata = order.metadata || {}, kot = metadata.kot || {};
    const approvalTime = minutes(order.createdAt, metadata.approved_at);
    if (approvalTime != null) approvalTimes.push(approvalTime);
    const prep = minutes(kot.prep_started_at || kot.accepted_at, kot.ready_at);
    if (prep != null) { kitchenTimes.push(prep); if (prep > Number(kot.estimated_prep_minutes || metadata.estimated_prep_minutes || 20)) lateKitchen++; }
    if (metadata.approval_status !== "approved" || ["rejected", "cancelled"].includes(status)) continue;
    const seen = new Set();
    for (const item of order.items) {
      const rule = item.modifiers?.price_rule;
      if (!rule?.id) continue;
      const saving = Math.round(Math.max(0, Number(rule.list_price) - Number(rule.discounted_price)) * 100) * item.quantity;
      if (!(saving > 0)) continue;
      const row = offers.get(rule.id) || { id: rule.id, name: rule.name || "Offer", orders: 0, units: 0, savings_paise: 0 };
      row.savings_paise += saving; row.units += item.quantity;
      if (!seen.has(rule.id)) row.orders++;
      seen.add(rule.id); offers.set(rule.id, row);
    }
  }
  const assistance = Object.entries(ASSISTANCE_KINDS).map(([kind, label]) => ({ kind, label, total: 0, resolved: 0, open: 0, expired: 0, overdue: 0, responseTimes: [], resolutionTimes: [] }));
  const byKind = new Map(assistance.map((row) => [row.kind, row]));
  for (const request of requests) {
    const row = byKind.get(request.kind); if (!row) continue;
    row.total++;
    const date = Number.isFinite(Date.parse(request.created_at)) ? day(request.created_at) : null;
    if (dailyByDate.has(date)) dailyByDate.get(date).requests++;
    const session = sessionById.get(request.session_id);
    const expired = ["pending", "accepted"].includes(request.status) && (!session || session.status !== "active" || Date.parse(request.created_at) < session.openedAt.getTime());
    const open = !expired && ["pending", "accepted"].includes(request.status);
    row.resolved += Number(request.status === "resolved"); row.expired += Number(expired); row.open += Number(open);
    row.overdue += Number(open && Date.now() - Date.parse(request.status === "accepted" ? request.accepted_at : request.created_at) > (request.status === "accepted" ? 5 : 2) * 60000);
    const response = minutes(request.created_at, request.accepted_at), resolution = minutes(request.created_at, request.resolved_at);
    if (response != null) row.responseTimes.push(response);
    if (resolution != null) row.resolutionTimes.push(resolution);
  }
  const reviews = feedback.map((row) => {
    const detail = detailByKey.get(reviewKey(businessId, row.id)) || {};
    return { id: row.id, rating: row.rating, comment: row.comment || "", created_at: row.createdAt.toISOString(), table: row.bill?.order?.metadata?.table_name || row.bill?.metadata?.table_label || "—",
      food_rating: detail.food_rating || null, service_rating: detail.service_rating || null, topics: detail.topics || [],
      status: detail.status || "new", internal_note: detail.internal_note || "", history: detail.history || [],
      needs_attention: [row.rating, detail.food_rating, detail.service_rating].some((value) => value != null && value <= 2) && detail.status !== "resolved" };
  });
  const ratings = reviews.filter((row) => Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5).map((row) => row.rating);
  return {
    period: { from: range.from, to: range.to, timezone: "UTC" }, checked_at: new Date().toISOString(),
    summary: { menu_opens: scans, orders: orders.length, accepted: orders.filter((order) => order.metadata?.approval_status === "approved" && !["cancelled", "rejected"].includes(guestProgress(order, order.kitchenTickets[0]?.status))).length,
      median_approval_minutes: median(approvalTimes), approval_samples: approvalTimes.length, median_prep_minutes: median(kitchenTimes), prep_samples: kitchenTimes.length, late_prep: lateKitchen,
      assistance_requests: requests.length, open_requests: assistance.reduce((sum, row) => sum + row.open, 0), overdue_requests: assistance.reduce((sum, row) => sum + row.overdue, 0),
      feedback_count: feedback.length, rating_samples: ratings.length, average_rating: average(ratings), food_rating: average(reviews.filter((row) => row.food_rating).map((row) => row.food_rating)),
      service_rating: average(reviews.filter((row) => row.service_rating).map((row) => row.service_rating)), needs_attention: reviews.filter((row) => row.needs_attention).length },
    pipeline: Object.entries(pipeline).map(([status, count]) => ({ status, count })), daily,
    assistance: assistance.filter((row) => row.total).map(({ responseTimes, resolutionTimes, ...row }) => ({ ...row, median_response_minutes: median(responseTimes), response_samples: responseTimes.length, median_resolution_minutes: median(resolutionTimes), resolution_samples: resolutionTimes.length })),
    offers: [...offers.values()].map(({ savings_paise, ...row }) => ({ ...row, savings: savings_paise / 100 })).sort((a, b) => b.orders - a.orders),
    rating_distribution: [5, 4, 3, 2, 1].map((rating) => ({ rating, count: ratings.filter((value) => value === rating).length })),
    reviews: reviews.slice(0, 100), attention_reviews: reviews.filter((row) => row.needs_attention).slice(0, 100), reviews_total: reviews.length,
  };
}
