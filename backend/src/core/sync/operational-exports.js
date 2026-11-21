import { readExportPage } from "../../shared/utils/export-cursor.js";
// Read-only projections for AdminCore. Domain writes remain in their existing services.
const definitions = {
  'privacy-erasures': { model: 'stateDocument', fields: '', title: 'customer_id' },
  "tip-payouts": { model: "tipPayout", fields: "outletId userName amount periodFrom periodTo method voidedAt", title: "userName", updated: false },
  payslips: { model: "payslip", fields: "runId userName role daysInPeriod daysPresent lopDays hoursWorked overtimeHours gross totalDeductions netPay tipsPaid paidAt paymentMethod", title: "userName" },
  "loyalty-ledger": { model: "loyaltyEntry", fields: "customerId billId type points value balanceAfter expiresAt", title: "type", updated: false },
  "gift-card-transactions": { model: "giftCardTransaction", fields: "giftCardId outletId type amount balanceAfter billId paymentMethod settlementShiftId", title: "type", updated: false },
  "marketing-delivery": { model: "marketingMessage", fields: "campaignId customerId channel status attempts nextAttemptAt sentAt deliveredAt readAt", title: "channel" },
  attendance: { model: "attendanceEntry", fields: "outletId userName userRole clockInAt clockOutAt breaks source note", where: { deletedAt: null }, title: "userName" },
  tips: { model: "tip", fields: "outletId recipientName amount pooled source method note voidedAt", title: "recipientName" },
  payroll: { model: "payrollRun", fields: "label periodFrom periodTo status finalizedAt note", title: "label" },
  "loyalty-customers": { model: "customer", fields: "name phone email tags marketingOptIn loyaltyPoints visitCount totalSpent firstVisitAt lastVisitAt anonymizedAt", title: "name" },
  "gift-cards": { model: "giftCard", fields: "outletId code recipientName initialValue balance status expiresAt", title: "recipientName" },
  marketing: { model: "marketingCampaign", fields: "name channel kind status scheduledAt startedAt completedAt sendHour", title: "name" },
  "menu-pricing": { model: "priceRule", fields: "name active discountType value daysOfWeek startMinute endMinute timezone channels outletIds productIds categories validFrom validTo", title: "name" },
  "guest-feedback": { model: "feedback", fields: "customerName rating comment billId", title: "customerName", updated: false },
  "table-assistance": { model: "stateDocument", fields: "", title: "table_name" },
};

export const OPERATIONAL_EXPORT_RESOURCES = Object.freeze(Object.keys(definitions));

export const exportOperationalRows = async ({ resource, business, query = {}, client }) => {
  const config = definitions[resource];
  if (!config) throw new Error("Unsupported operational export");
  if (!business?.id || !business?.tenantId) throw new Error("A verified business and tenant are required");
  const limit = Number(query.limit ?? 100);
  const offset = Number(query.offset ?? 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Invalid export pagination");
  }
  if (resource === 'privacy-erasures') {
    const docs = await readExportPage(client.stateDocument, {
      where: { key: { startsWith: `privacy-erasure:${business.id}:` } },
      select: { key: true, data: true }, orderBy: { key: 'asc' }, take: limit, skip: offset,
    }, query, { idField: 'key' });
    return docs.map(({ data }) => {
      if (data.business_id !== business.id) throw new Error('Erasure marker business mismatch');
      return { id: data.id, customer_id: data.customer_id, phone_digest: data.phone_digest,
        digest_key_id: data.digest_key_id,
        bill_ids: data.bill_ids || [], order_ids: data.order_ids || [],
        email_digest: data.email_digest, erased_at: data.erased_at,
        business_id: business.id, tenant_id: business.tenantId };
    });
  }
  if (resource === "table-assistance") {
    const docs = await readExportPage(client.stateDocument, {
      where: { key: { startsWith: `assistance:${business.id}:` }, ...(query.outlet_id || query.outletId ? { data: { path: ["outlet_id"], equals: String(query.outlet_id || query.outletId) } } : {}) },
      select: { key: true, data: true }, orderBy: { key: "asc" }, take: limit, skip: offset,
    }, query, { idField: "key" });
    const sessionIds = [...new Set(docs.map(doc => doc.data.session_id).filter(Boolean))];
    const sessions = sessionIds.length ? await client.tableSession.findMany({ where: { businessId: business.id, id: { in: sessionIds } }, select: { id: true, status: true, openedAt: true } }) : [];
    const fields = "id business_id outlet_id table_id table_name kind note payment_method status created_at accepted_at resolved_at assignee_name".split(" ");
    return docs.map(({ data }) => {
      if (data.business_id !== business.id) throw new Error("Export returned a record outside the verified business");
      const row = Object.fromEntries(fields.map(key => [key, data[key] ?? null]));
      const session = sessions.find(item => item.id === data.session_id);
      if (["pending", "accepted"].includes(row.status) && (!session || session.status !== "active" || Date.parse(row.created_at) < new Date(session.openedAt).getTime())) row.status = "expired";
      return { ...row, tenant_id: business.tenantId, tenantId: business.tenantId, title: `${row.table_name || "Table"}: ${row.kind || "Assistance"}` };
    });
  }
  const fields = ["id", "businessId", "createdAt", ...(config.updated === false ? [] : ["updatedAt"]), ...config.fields.split(" ")];
  const select = Object.fromEntries(fields.map(field => [field, true]));
  if (resource === "payroll") select._count = { select: { payslips: true } };
  const requestedOutlet = query.outlet_id || query.outletId;
  const where = { businessId: business.id, ...config.where };
  // Do not silently present business-wide data as an outlet-specific export.
  if (requestedOutlet) {
    if (config.fields.split(" ").includes("outletId")) where.outletId = String(requestedOutlet);
    else if (resource === "menu-pricing") where.OR = [{ outletIds: { isEmpty: true } }, { outletIds: { has: String(requestedOutlet) } }];
    else throw new Error("This export is business-wide; remove the outlet filter");
  }
  const rows = await readExportPage(client[config.model], { where, select, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit, skip: offset }, query);
  return rows.map(source => {
    const { code, _count, ...row } = source;
    if (row.businessId !== business.id) throw new Error("Export returned a record outside the verified business");
    let status = row.status || "active";
    if (resource === "attendance") status = row.clockOutAt ? "completed" : "clocked_in";
    if (["tips", "tip-payouts"].includes(resource) && row.voidedAt) status = "void";
    if (resource === "payslips") status = row.paidAt ? "paid" : "unpaid";
    if (["loyalty-ledger", "gift-card-transactions"].includes(resource)) status = row.type || "recorded";
    if (resource === "loyalty-customers" && row.anonymizedAt) {
      status = "anonymized";
      row.name = "Anonymized customer"; row.phone = null; row.email = null; row.tags = [];
    }
    if (resource === "menu-pricing") status = row.active ? "active" : "inactive";
    if (resource === "guest-feedback") status = "received";
    return {
      ...row, business_id: business.id, tenant_id: business.tenantId, tenantId: business.tenantId,
      outlet_id: row.outletId || null, status, title: row[config.title] || resource,
      created_at: row.createdAt, updated_at: row.updatedAt,
      ...(code ? { masked_code: `•••• ${code.slice(-4)}` } : {}),
      ...(_count ? { payslip_count: _count.payslips } : {}),
    };
  });
};
