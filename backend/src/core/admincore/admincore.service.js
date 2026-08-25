import env from "../../config/env.js";

const syncStatuses = [];
const HEALTH_TIMEOUT_MS = 5000;

const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const getConfig = () => ({
  enabled: Boolean(env.admincore.enabled),
  admincoreBaseUrl: trimTrailingSlash(env.admincore.apiBaseUrl),
  posBaseUrl: env.admincore.posBaseUrl,
});

export const getAdmincoreConnection = () => {
  const config = getConfig();
  const configured = config.enabled && Boolean(config.admincoreBaseUrl);

  return {
    connected: configured,
    admincore_base_url: config.admincoreBaseUrl || null,
    pos_base_url: config.posBaseUrl,
    project: "CashFlow Lite POS",
    status: configured ? "linked" : "not_configured",
    last_sync_status: syncStatuses[0] || null,
  };
};

export const checkAdmincoreHealth = async () => {
  const connection = getAdmincoreConnection();

  if (!connection.connected) {
    return {
      ...connection,
      connected: false,
      admincore_reachable: false,
      message: "AdminCore link is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${connection.admincore_base_url}/api/pos-bridge/config`, {
      method: "GET",
      headers: env.admincore.apiKey
        ? {
            "x-admincore-api-key": env.admincore.apiKey,
          }
        : {},
      signal: controller.signal,
    });

    return {
      connected: true,
      admincore_reachable: true,
      message: "POS project is linked to AdminCore",
      admincore_base_url: connection.admincore_base_url,
      pos_base_url: connection.pos_base_url,
      project: connection.project,
      status: "linked",
      admincore_status_code: response.status,
    };
  } catch (error) {
    return {
      ...connection,
      connected: false,
      admincore_reachable: false,
      message: "AdminCore is not reachable",
      error: error.name === "AbortError" ? "Health check timed out" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const recordAdmincoreSyncStatus = (payload = {}) => {
  const status = {
    id: `sync-${Date.now()}`,
    resource: payload.resource || "unknown",
    synced_count: Number(payload.synced_count || 0),
    error_count: Number(payload.error_count || 0),
    synced_at: payload.synced_at || new Date().toISOString(),
    received_at: new Date().toISOString(),
  };

  syncStatuses.unshift(status);
  if (syncStatuses.length > 100) {
    syncStatuses.pop();
  }

  return status;
};
