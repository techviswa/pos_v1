import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { businessesService } from "../businesses/businesses.service.js";
import { outletsService } from "../outlets/outlets.service.js";
import { productsService } from "../products/products.service.js";
import { ordersService } from "../orders/orders.service.js";
import { usersService } from "../users/users.service.js";
import { inventoryService } from "../inventory/inventory.service.js";
import { billingService } from "../billing/billing.service.js";
import { paymentsService } from "../payments/payments.service.js";
import { kotService } from "../../features/kitchen/kot/kot.service.js";
import { tableManagementService } from "../../features/sales-extensions/table-management/table-management.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { normalizeBillingMetadata } from "../billing/billing-metadata.utils.js";
import {
  listAdminCoreSyncLogs,
  normalizeAdminCoreSyncResource,
  recordAdminCoreSyncLog,
} from "./admincore-sync-log.repository.js";
import { createSyncEnvelope } from "./sync-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../../../data");
const eventsPath = path.join(dataDirectory, "offline-sync-events.json");

const nowIso = () => new Date().toISOString();
const ADMINCORE_SYNC_RESOURCES = [
  "businesses",
  "outlets",
  "products",
  "orders",
  "bills",
  "customers",
  "payments",
  "staff",
  "inventory",
  "tables",
  "reservations",
  "kot",
];

const readEvents = async () => {
  try {
    const raw = await readFile(eventsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeEvents = async (events) => {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(eventsPath, JSON.stringify(events, null, 2), "utf8");
};

const normalizeResource = (resource) => {
  return normalizeAdminCoreSyncResource(resource);
};

const normalizeExportData = (resource, data) => {
  if (resource === "tables") {
    return data.items || [];
  }
  if (resource === "reservations") {
    return data.items || [];
  }
  if (resource === "kot") {
    return data.items || [];
  }
  return Array.isArray(data) ? data : data?.items || [];
};

const getCustomerKey = ({ name, phone }) => {
  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  return `name:${String(name || "Walk-in Customer").trim().toLowerCase()}`;
};

const serializeCustomerRows = ({ bills = [], orders = [], tenantId, businessId }) => {
  const rowsByKey = new Map();
  const upsert = (row) => {
    const name = String(row.customer_name || row.customerName || "Walk-in Customer").trim() || "Walk-in Customer";
    const phone = row.customer_phone || row.metadata?.customer_phone || null;
    const key = getCustomerKey({ name, phone });
    const current = rowsByKey.get(key) || {
      id: key.replace(/[^a-zA-Z0-9_-]/g, "_"),
      customer_id: key.replace(/[^a-zA-Z0-9_-]/g, "_"),
      tenantId,
      tenant_id: tenantId,
      business_id: businessId,
      name,
      phone,
      email: null,
      order_count: 0,
      bill_count: 0,
      total_spent: 0,
      first_seen_at: row.created_at || row.createdAt?.toISOString?.() || nowIso(),
      last_seen_at: row.updated_at || row.updatedAt?.toISOString?.() || row.created_at || nowIso(),
      sync_source: "pos-core",
      sync_resource: "customers",
      last_synced_at: nowIso(),
    };

    current.order_count += row.order_id || row.channel ? 1 : 0;
    current.bill_count += row.invoice_number || row.bill_id || row.currency ? 1 : 0;
    current.total_spent += Number(row.total || 0);
    current.last_seen_at = [current.last_seen_at, row.updated_at || row.created_at].filter(Boolean).sort().at(-1);
    rowsByKey.set(key, current);
  };

  bills.forEach(upsert);
  orders.forEach(upsert);
  return [...rowsByKey.values()];
};

const serializePaymentRows = ({ bills = [], intents = [], tenantId, businessId }) => {
  const billPayments = bills.flatMap((bill) => {
    const metadata = normalizeBillingMetadata(bill.metadata || bill);
    return (metadata.payments || []).map((payment, index) => ({
      id: payment.id || `${bill.id}_payment_${index + 1}`,
      payment_id: payment.id || `${bill.id}_payment_${index + 1}`,
      tenantId,
      tenant_id: tenantId,
      business_id: businessId,
      outlet_id: metadata.outlet_id || bill.outlet_id || null,
      bill_id: bill.id,
      order_id: bill.order_id || null,
      invoice_number: metadata.invoice_number || bill.invoice_number || bill.id,
      method: payment.method,
      amount: Number(payment.amount || 0),
      status: payment.status || "confirmed",
      reference: payment.reference || null,
      gateway: payment.gateway || null,
      customer_name: bill.customerName || bill.customer_name || null,
      customer_phone: metadata.customer_phone || null,
      received_at: payment.received_at || bill.created_at || null,
      confirmed_at: payment.status === "confirmed" ? payment.received_at || bill.created_at || null : null,
      sync_source: "pos-core",
      sync_resource: "payments",
      last_synced_at: bill.updated_at || bill.created_at || nowIso(),
    }));
  });

  const intentPayments = intents.map((intent) => ({
    ...intent,
    tenantId,
    tenant_id: tenantId,
    business_id: businessId,
    payment_id: intent.id,
    bill_id: intent.invoice_id || null,
    amount: Number(intent.amount || 0),
    sync_source: "pos-core",
    sync_resource: "payments",
    last_synced_at: intent.updated_at || nowIso(),
  }));

  return [...billPayments, ...intentPayments];
};

class SyncService {
  getStrategy() {
    return {
      mode: "online-first-with-client-event-buffer",
      server_conflict_policy: "latest-server-version-wins-until-record-level-versioning-is-added",
      supported_resources: ADMINCORE_SYNC_RESOURCES,
      client_requirements: [
        "Keep writes in a local queue when offline",
        "Replay queued writes to /api/sync/client-events after reconnect",
        "Use idempotency_key for every replayed write",
      ],
      production_notes: [
        "Move sync events to a durable table during the Postgres phase",
        "Add record version columns before enabling multi-device conflict resolution",
      ],
    };
  }

  async listClientEvents({ tenantId, status } = {}) {
    const events = await readEvents();
    return events
      .filter((event) => !tenantId || event.tenant_id === tenantId)
      .filter((event) => !status || event.status === status)
      .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  }

  async recordClientEvent({ tenantId, businessId, user, payload }) {
    const events = await readEvents();
    const event = {
      id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: tenantId,
      business_id: businessId,
      user_id: user?.id || null,
      resource: payload.resource || "unknown",
      action: payload.action || "upsert",
      idempotency_key: payload.idempotency_key || null,
      payload: payload.payload || {},
      status: "received",
      received_at: nowIso(),
    };

    const duplicate = event.idempotency_key
      ? events.find((item) => item.tenant_id === tenantId && item.idempotency_key === event.idempotency_key)
      : null;

    if (duplicate) {
      return { ...duplicate, duplicate: true };
    }

    events.push(event);
    await writeEvents(events.slice(-1000));
    return event;
  }

  async listAdminCoreLogs({ tenantId, resource, status } = {}) {
    return listAdminCoreSyncLogs({ tenantId, resource, status });
  }

  async recordAdminCoreLog(payload = {}) {
    return recordAdminCoreSyncLog(payload);
  }

  async exportResource({ resource, tenantId, businessId, query = {} }) {
    const normalizedResource = normalizeResource(resource);
    let data;

    if (normalizedResource === "businesses") {
      data = await businessesService.listBusinesses({ businessId });
    } else if (normalizedResource === "outlets") {
      data = await outletsService.listOutlets({ tenantId, businessId });
    } else if (normalizedResource === "products") {
      data = await productsService.listProducts({ tenantId, query });
    } else if (normalizedResource === "orders") {
      data = await ordersService.listOrders({ tenantId, query });
    } else if (normalizedResource === "bills") {
      data = await billingService.listInvoices({
        tenantId,
        limit: query.limit,
        page: query.page,
        offset: query.offset,
      });
    } else if (normalizedResource === "customers") {
      const [bills, orders] = await Promise.all([
        billingService.listInvoices({
          tenantId,
          limit: query.limit || 500,
          page: query.page,
          offset: query.offset,
        }),
        ordersService.listOrders({
          tenantId,
          query: {
            limit: query.limit || 500,
            page: query.page,
            offset: query.offset,
          },
        }),
      ]);
      data = serializeCustomerRows({ bills, orders, tenantId, businessId });
    } else if (normalizedResource === "payments") {
      const bills = await billingService.listInvoices({
        tenantId,
        limit: query.limit || 500,
        page: query.page,
        offset: query.offset,
      });
      data = serializePaymentRows({
        bills,
        intents: paymentsService.listIntents({ status: query.status }),
        tenantId,
        businessId,
      });
    } else if (normalizedResource === "staff") {
      data = await usersService.listUsers({ tenantId, businessId });
    } else if (normalizedResource === "inventory") {
      data = await inventoryService.listItems({ tenantId, query });
    } else if (normalizedResource === "tables") {
      data = await tableManagementService.listTables({ tenantId, businessId });
    } else if (normalizedResource === "reservations") {
      data = await tableManagementService.listReservations({ tenantId, businessId, includeHistory: true });
    } else if (normalizedResource === "kot") {
      data = await kotService.listTickets({
        tenantId,
        limit: query.limit,
        status: query.status,
        stationId: query.station_id || query.stationId,
      });
    } else {
      throw createHttpError({
        statusCode: 400,
        code: "UNSUPPORTED_SYNC_RESOURCE",
        message: `Unsupported AdminCore sync resource: ${resource}`,
        details: {
          supported_resources: ADMINCORE_SYNC_RESOURCES,
        },
      });
    }

    const items = normalizeExportData(normalizedResource, data);
    const syncedAt = new Date().toISOString();
    const log = await this.recordAdminCoreLog({
      tenant_id: tenantId,
      business_id: businessId,
      outlet_id: query.outlet_id || query.outletId || null,
      resource: normalizedResource,
      status: "success",
      synced_count: items.length,
      error_count: 0,
      synced_at: syncedAt,
      message: `Exported ${items.length} ${normalizedResource} records for AdminCore`,
    });

    return {
      ...createSyncEnvelope({
        resource: normalizedResource,
        data: items,
        tenantId,
        businessId,
        outletId: query.outlet_id || query.outletId || null,
        lastSyncedAt: syncedAt,
      }),
      sync_log_id: log.id,
    };
  }
}

export const syncService = new SyncService();
