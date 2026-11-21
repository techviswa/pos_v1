import { randomUUID } from "crypto";
import env from "../../config/env.js";
import { startTenantRequest } from "../../database/prisma/tenant-context.js";

export const requestContextMiddleware = (req, res, next) => {
  // Client-supplied ids end up in logs and response headers: keep them short and plain.
  const supplied = String(req.headers["x-request-id"] || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
  const requestId = supplied || randomUUID();

  req.context = {
    tenantId: env.defaultTenantId,
    businessId: env.defaultBusinessId,
    requestId,
  };

  res.setHeader("x-request-id", requestId);
  startTenantRequest(next);
};
