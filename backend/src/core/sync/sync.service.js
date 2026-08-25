import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { businessesService } from "../businesses/businesses.service.js";
import { outletsService } from "../outlets/outlets.service.js";
import { productsService } from "../products/products.service.js";
import { ordersService } from "../orders/orders.service.js";
import { usersService } from "../users/users.service.js";
import { inventoryService } from "../inventory/inventory.service.js";
import { tableManagementService } from "../../features/sales-extensions/table-management/table-management.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { createSyncEnvelope } from "./sync-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../../../data");
const eventsPath = path.join(dataDirectory, "offline-sync-events.json");
const admincoreLogsPath = path.join(dataDirectory, "admincore-sync-logs.json");

const nowIso = () => new Date().toISOString();

const readEvents = async () => {
  try {
    const raw = await readFile(eventsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const readAdminCoreLogs = async () => {
  try {
    const raw = await readFile(admincoreLogsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeEvents = async (events) => {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(eventsPath, JSON.stringify(events, null, 2), "utf8");
};

const writeAdminCoreLogs = async (logs) => {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(admincoreLogsPath, JSON.stringify(logs, null, 2), "utf8");
};

const normalizeResource = (resource) => {
  const normalized = String(resource || "").trim().toLowerCase();
  if (["users", "user", "staffs"].includes(normalized)) return "staff";
  if (["table", "table-management", "dining-tables"].includes(normalized)) return "tables";
  if (["reservation", "table-reservations", "reservations"].includes(normalized)) return "reservations";
  return normalized;
};

const normalizeExportData = (resource, data) => {
  if (resource === "tables") {
    return data.items || [];
  }
  if (resource === "reservations") {
    return data.items || [];
  }
  return Array.isArray(data) ? data : data?.items || [];
};

class SyncService {
  getStrategy() {
    return {
      mode: "online-first-with-client-event-buffer",
      server_conflict_policy: "latest-server-version-wins-until-record-level-versioning-is-added",
      supported_resources: ["businesses", "outlets", "products", "orders", "staff", "inventory", "tables", "reservations"],
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
    const logs = await readAdminCoreLogs();
    return logs
      .filter((log) => !tenantId || log.tenant_id === tenantId)
      .filter((log) => !resource || log.resource === normalizeResource(resource))
      .filter((log) => !status || log.status === status)
      .sort((a, b) => String(b.synced_at).localeCompare(String(a.synced_at)));
  }

  async recordAdminCoreLog(payload = {}) {
    const logs = await readAdminCoreLogs();
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
      synced_at: payload.synced_at || new Date().toISOString(),
    };

    logs.push(log);
    await writeAdminCoreLogs(logs.slice(-1000));
    return log;
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
    } else if (normalizedResource === "staff") {
      data = await usersService.listUsers({ tenantId, businessId });
    } else if (normalizedResource === "inventory") {
      data = await inventoryService.listItems({ tenantId, query });
    } else if (normalizedResource === "tables") {
      data = await tableManagementService.listTables({ tenantId, businessId });
    } else if (normalizedResource === "reservations") {
      data = await tableManagementService.listReservations({ tenantId, businessId, includeHistory: true });
    } else {
      throw createHttpError({
        statusCode: 400,
        code: "UNSUPPORTED_SYNC_RESOURCE",
        message: `Unsupported AdminCore sync resource: ${resource}`,
        details: {
          supported_resources: ["businesses", "outlets", "products", "orders", "staff", "inventory", "tables", "reservations"],
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
