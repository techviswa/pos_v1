import { createHttpError } from "../../shared/utils/http-error.js";

const resolveIdentity = (values, label) => {
  const supplied = values.filter((value) => value !== undefined && value !== null && value !== "");
  if (supplied.some((value) => typeof value !== "string" || !value.trim())) {
    throw createHttpError({ statusCode: 400, code: "ADMINCORE_INVALID_CONTEXT", message: `${label} must be a nonempty string` });
  }
  const unique = [...new Set(supplied.map((value) => value.trim()))];
  if (unique.length > 1) {
    throw createHttpError({ statusCode: 400, code: "ADMINCORE_CONFLICTING_CONTEXT", message: `Conflicting ${label} values in bridge request` });
  }
  return unique[0];
};

export const resolveBridgeContext = (req) => ({
  businessId: resolveIdentity([req.body?.business_id, req.body?.businessId,
    req.get("x-business-id"), req.get("business_id")], "business_id"),
  tenantId: resolveIdentity([req.body?.tenant_id, req.body?.tenantId,
    req.get("x-tenant-id")], "tenant_id"),
});
