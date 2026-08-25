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
  const resource = req.params?.resource || req.originalUrl?.split("?")[0]?.split("/")?.filter(Boolean)?.at(-1) || "unknown";

  errorMonitor.captureRequestException(error, req);

  logger.error({
    requestId: req.context?.requestId,
    code,
    statusCode,
    message: error.message,
    stack: error.stack,
  });

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
      message: error.message || "Internal server error",
      code,
      details: error.details,
      requestId: req.context?.requestId,
    },
  });
};
