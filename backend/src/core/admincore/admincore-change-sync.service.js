import env from "../../config/env.js";
import { jobQueue } from "../../services/jobs/job-queue.js";
import { recordAdminCoreSyncLog } from "../sync/admincore-sync-log.repository.js";
import { recordAdmincoreSyncStatus } from "./admincore.service.js";

const JOB_TYPE = "admincore.notify-change";
const NOTIFY_TIMEOUT_MS = 5000;
const SUPPORTED_RESOURCES = new Set([
  "businesses",
  "outlets",
  "products",
  "orders",
  "bills",
  "staff",
  "inventory",
  "tables",
  "reservations",
]);

const nowIso = () => new Date().toISOString();
const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const normalizeResource = (resource) => {
  const normalized = String(resource || "").trim().toLowerCase();
  if (["bill", "billing", "invoices", "invoice"].includes(normalized)) return "bills";
  if (["order"].includes(normalized)) return "orders";
  if (["product", "menu"].includes(normalized)) return "products";
  if (["user", "users", "staffs"].includes(normalized)) return "staff";
  if (["table", "dining-tables", "table-management"].includes(normalized)) return "tables";
  if (["reservation", "table-reservations"].includes(normalized)) return "reservations";
  if (["outlet"].includes(normalized)) return "outlets";
  if (["inventory-item", "stock"].includes(normalized)) return "inventory";
  if (["business"].includes(normalized)) return "businesses";
  return normalized || "unknown";
};

const buildWebhookUrl = () => {
  const explicitUrl = trimTrailingSlash(env.admincore.syncWebhookUrl);
  if (explicitUrl) return explicitUrl;

  const baseUrl = trimTrailingSlash(env.admincore.apiBaseUrl);
  return baseUrl ? `${baseUrl}/api/pos-bridge/sync-status` : "";
};

const buildExportUrl = ({ resource, tenantId, businessId, outletId }) => {
  const baseUrl = trimTrailingSlash(env.admincore.posBaseUrl);
  if (!baseUrl) return null;

  const params = new URLSearchParams();
  if (tenantId) params.set("tenant_id", tenantId);
  if (businessId) params.set("business_id", businessId);
  if (outletId) params.set("outlet_id", outletId);

  const queryString = params.toString();
  return `${baseUrl}/api/sync/export/${resource}${queryString ? `?${queryString}` : ""}`;
};

class AdmincoreChangeSyncService {
  constructor() {
    jobQueue.registerHandler(JOB_TYPE, async (payload) => this.deliverChange(payload));
  }

  isConfigured() {
    return Boolean(env.admincore.enabled && env.admincore.apiBaseUrl);
  }

  async notifyChange(payload = {}) {
    try {
      const resource = normalizeResource(payload.resource);
      const event = {
        id: payload.id || `admincore_change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        resource,
        action: payload.action || "updated",
        record_id: payload.recordId || payload.record_id || null,
        tenant_id: payload.tenantId || payload.tenant_id || null,
        business_id: payload.businessId || payload.business_id || null,
        outlet_id: payload.outletId || payload.outlet_id || null,
        sync_source: "pos",
        changed_at: payload.changedAt || payload.changed_at || nowIso(),
        pos_base_url: trimTrailingSlash(env.admincore.posBaseUrl),
        export_url: buildExportUrl({
          resource,
          tenantId: payload.tenantId || payload.tenant_id,
          businessId: payload.businessId || payload.business_id,
          outletId: payload.outletId || payload.outlet_id,
        }),
        metadata: payload.metadata || {},
      };

      await recordAdminCoreSyncLog({
        tenant_id: event.tenant_id,
        business_id: event.business_id,
        outlet_id: event.outlet_id,
        resource,
        direction: "pos_to_admincore",
        status: this.isConfigured() ? "queued" : "not_configured",
        synced_count: SUPPORTED_RESOURCES.has(resource) ? 1 : 0,
        error_count: this.isConfigured() ? 0 : 1,
        synced_at: event.changed_at,
        message: this.isConfigured()
          ? `Queued ${resource} ${event.action} notification for AdminCore`
          : "AdminCore notification skipped because ADMINCORE_ENABLED/API base URL is not configured",
        metadata: event,
      });

      if (!this.isConfigured()) {
        return { queued: false, reason: "not_configured", event };
      }

      const job = jobQueue.enqueue(JOB_TYPE, event, { maxAttempts: 3 });
      return { queued: true, job_id: job.id, event };
    } catch (error) {
      return {
        queued: false,
        reason: "local_log_failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deliverChange(event) {
    const webhookUrl = buildWebhookUrl();
    if (!webhookUrl) {
      await this.recordDeliveryFailure(event, "AdminCore sync webhook URL is not configured");
      return { delivered: false, reason: "not_configured" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.admincore.apiKey ? { "x-admincore-api-key": env.admincore.apiKey } : {}),
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AdminCore webhook returned ${response.status}`);
      }

      await recordAdminCoreSyncLog({
        tenant_id: event.tenant_id,
        business_id: event.business_id,
        outlet_id: event.outlet_id,
        resource: event.resource,
        direction: "pos_to_admincore",
        status: "notified",
        synced_count: 1,
        error_count: 0,
        synced_at: nowIso(),
        message: `AdminCore notified for ${event.resource} ${event.action}`,
        metadata: event,
      });

      recordAdmincoreSyncStatus({
        resource: event.resource,
        synced_count: 1,
        error_count: 0,
        synced_at: nowIso(),
      });

      return { delivered: true, webhook_url: webhookUrl };
    } catch (error) {
      const message = error.name === "AbortError" ? "AdminCore sync notification timed out" : error.message;
      await this.recordDeliveryFailure(event, message);
      return { delivered: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  async recordDeliveryFailure(event, message) {
    await recordAdminCoreSyncLog({
      tenant_id: event.tenant_id,
      business_id: event.business_id,
      outlet_id: event.outlet_id,
      resource: event.resource,
      direction: "pos_to_admincore",
      status: "notify_failed",
      synced_count: 0,
      error_count: 1,
      synced_at: nowIso(),
      message,
      metadata: event,
    });

    recordAdmincoreSyncStatus({
      resource: event.resource,
      synced_count: 0,
      error_count: 1,
      synced_at: nowIso(),
    });
  }
}

export const admincoreChangeSyncService = new AdmincoreChangeSyncService();
