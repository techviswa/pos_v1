import prisma from "../../database/prisma/client.js";

const normalizeResource = (resource) => {
  const normalized = String(resource || "").trim().toLowerCase();
  if (["users", "user", "staffs"].includes(normalized)) return "staff";
  if (["bill", "billing", "invoice", "invoices"].includes(normalized)) return "bills";
  if (["customer", "customer-profiles", "guest", "guests"].includes(normalized)) return "customers";
  if (["payment", "payment-intents", "transactions", "transaction"].includes(normalized)) return "payments";
  if (["kitchen", "kitchen-tickets", "kitchen-ticket", "kot-tickets"].includes(normalized)) return "kot";
  if (["table", "table-management", "dining-tables"].includes(normalized)) return "tables";
  if (["reservation", "table-reservations", "reservations"].includes(normalized)) return "reservations";
  if (["qr-codes", "qr-code", "qr-ordering", "table-qr"].includes(normalized)) return "qr";
  if (["central-kitchen", "purchase-orders", "allocations", "routes"].includes(normalized)) return "central-kitchen";
  if (["tax", "taxes-charges", "charges"].includes(normalized)) return "taxes";
  if (["discount", "discounts-coupons", "coupon", "coupons"].includes(normalized)) return "discounts";
  if (["supplier", "suppliers-purchasing", "purchasing", "vendors"].includes(normalized)) return "suppliers";
  if (["hardware-printers", "printers", "printer-settings"].includes(normalized)) return "hardware";
  if (["role-permissions", "permissions-matrix", "roles"].includes(normalized)) return "permissions";
  if (["integrations-webhooks", "webhook", "integration", "integrations"].includes(normalized)) return "webhooks";
  if (["audit-security", "audit", "security", "audit-logs"].includes(normalized)) return "audit-security";
  return normalized || "unknown";
};

export const listAdminCoreSyncLogs = async ({ tenantId, resource, status } = {}) => {
  const rows = await prisma.adminCoreSyncLog.findMany({
    where: { ...(tenantId ? { tenantId } : {}), ...(resource ? { resource: normalizeResource(resource) } : {}), ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" }, take: 1000,
  });
  return rows.map((row) => row.data);
};

export const recordAdminCoreSyncLog = async (payload = {}) => {
  const log = {
    id: payload.id || `admincore_sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenant_id: payload.tenant_id || payload.tenantId || null,
    business_id: payload.business_id || payload.businessId || null,
    outlet_id: payload.outlet_id || payload.outletId || null,
    resource: normalizeResource(payload.resource || "unknown"),
    direction: payload.direction || "pos_to_admincore",
    status: payload.status || "success",
    synced_count: Number(payload.synced_count || 0),
    error_count: Number(payload.error_count || 0),
    message: payload.message || "",
    metadata: payload.metadata || {},
    synced_at: payload.synced_at || new Date().toISOString(),
  };

  await prisma.adminCoreSyncLog.create({ data: {
    id: log.id, tenantId: log.tenant_id, resource: log.resource, status: log.status,
    data: JSON.parse(JSON.stringify(log)),
  } });
  return log;
};

export { normalizeResource as normalizeAdminCoreSyncResource };
