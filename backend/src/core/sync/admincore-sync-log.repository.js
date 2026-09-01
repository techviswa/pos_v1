import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../../../data");
const admincoreLogsPath = path.join(dataDirectory, "admincore-sync-logs.json");

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

const readLogs = async () => {
  try {
    const raw = await readFile(admincoreLogsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeLogs = async (logs) => {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(admincoreLogsPath, JSON.stringify(logs, null, 2), "utf8");
};

export const listAdminCoreSyncLogs = async ({ tenantId, resource, status } = {}) => {
  const logs = await readLogs();
  const normalizedResource = resource ? normalizeResource(resource) : null;

  return logs
    .filter((log) => !tenantId || log.tenant_id === tenantId)
    .filter((log) => !normalizedResource || log.resource === normalizedResource)
    .filter((log) => !status || log.status === status)
    .sort((a, b) => String(b.synced_at).localeCompare(String(a.synced_at)));
};

export const recordAdminCoreSyncLog = async (payload = {}) => {
  const logs = await readLogs();
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

  logs.push(log);
  await writeLogs(logs.slice(-1000));
  return log;
};

export { normalizeResource as normalizeAdminCoreSyncResource };
