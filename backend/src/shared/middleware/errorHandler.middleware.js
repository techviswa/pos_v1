import { logger } from "../utils/logger.js";
import { errorMonitor } from "../utils/error-monitor.js";

export const errorHandlerMiddleware = (error, req, res, _next) => {
  const statusCode = Number(error.statusCode || 500);
  const code = error.code || (statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR");
  const isAdminCoreSyncRequest =
    String(req.query?.sync || "").toLowerCase() === "admincore" ||
    String(req.query?.admincore || "").toLowerCase() === "true" ||
    String(req.get("x-admincore-sync") || "").toLowerCase() === "true" ||
    req.originalUrl?.startsWith("/api/sync/export/");
  // Server faults can carry database/driver text; customers only ever see a generic message in production.
  const publicMessage = statusCode >= 500 && process.env.NODE_ENV === "production"
    ? "Internal server error"
    : error.message || "Internal server error";
  const resource = req.params?.resource || req.originalUrl?.split("?")[0]?.split("/")?.filter(Boolean)?.at(-1) || "unknown";

  errorMonitor.captureRequestException(error, req);

  const logEntry = {
    requestId: req.context?.requestId,
    tenantId: req.context?.tenantId,
    businessId: req.context?.businessId,
    userId: req.user?.id,
    method: req.method,
    path: req.originalUrl?.split("?")[0],
    code,
    statusCode,
    message: error.message,
  };
  // Expected client errors (401/403/404/409/429...) are warnings without stacks; only real faults page someone.
  if (statusCode >= 500) logger.error({ ...logEntry, stack: error.stack });
  else logger.warn(logEntry);

  res.status(statusCode).json({
    success: false,
    ...(isAdminCoreSyncRequest
      ? {
          resource,
          sync_source: "pos-core",
          tenant_id: req.context?.tenantId || null,
          business_id: req.context?.businessId || null,
          count: 0,
          items: [],
          data: [],
          meta: {
            sync_contract: "admincore-pos-v1",
            status: "failed",
            resource,
            tenant_id: req.context?.tenantId || null,
            business_id: req.context?.businessId || null,
          },
        }
      : {}),
    error: {
      message: publicMessage,
      code,
      details: statusCode >= 500 && process.env.NODE_ENV === "production" ? undefined : error.details,
      requestId: req.context?.requestId,
    },
  });
};
