import { randomUUID } from "crypto";
import env from "../../config/env.js";

export const requestContextMiddleware = (req, res, next) => {
  // Client-supplied ids end up in logs and response headers: keep them short and plain.
  const supplied = String(req.headers["x-request-id"] || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  const requestId = supplied || randomUUID();

  req.context = {
    tenantId: req.headers["x-tenant-id"] || env.defaultTenantId,
    businessId: req.headers.business_id || env.defaultBusinessId,
    requestId,
  };

  res.setHeader("x-request-id", requestId);
  next();
};
