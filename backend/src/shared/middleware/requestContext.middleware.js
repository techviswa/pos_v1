import { randomUUID } from "crypto";
import env from "../../config/env.js";

export const requestContextMiddleware = (req, res, next) => {
  const requestId = req.headers["x-request-id"] || randomUUID();

  req.context = {
    tenantId: req.headers["x-tenant-id"] || env.defaultTenantId,
    businessId: req.headers.business_id || env.defaultBusinessId,
    requestId,
  };

  res.setHeader("x-request-id", requestId);
  next();
};
