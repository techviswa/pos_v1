const normalizeItems = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return data ? [data] : [];
};

export const isAdminCoreSyncRequest = (req) =>
  String(req.query?.sync || "").toLowerCase() === "admincore" ||
  String(req.query?.admincore || "").toLowerCase() === "true" ||
  String(req.get("x-admincore-sync") || "").toLowerCase() === "true";

export const createSyncEnvelope = ({
  resource,
  data,
  tenantId,
  businessId,
  outletId = null,
  syncSource = "pos-core",
  lastSyncedAt = new Date().toISOString(),
}) => {
  const items = normalizeItems(data);

  return {
    success: true,
    resource,
    sync_source: syncSource,
    tenant_id: tenantId || null,
    business_id: businessId || null,
    outlet_id: outletId || null,
    count: items.length,
    last_synced_at: lastSyncedAt,
    items,
    data: items,
    meta: {
      sync_contract: "admincore-pos-v1",
      sync_source: syncSource,
      tenant_id: tenantId || null,
      business_id: businessId || null,
      outlet_id: outletId || null,
      resource,
      count: items.length,
      last_synced_at: lastSyncedAt,
    },
  };
};

export const sendSyncOrRaw = (req, res, { resource, data, tenantId, businessId, outletId, statusCode = 200 }) => {
  if (isAdminCoreSyncRequest(req)) {
    return res.status(statusCode).json(
      createSyncEnvelope({
        resource,
        data,
        tenantId,
        businessId,
        outletId,
      }),
    );
  }

  return res.status(statusCode).json(data);
};
