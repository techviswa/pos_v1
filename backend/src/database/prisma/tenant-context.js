import { AsyncLocalStorage } from "node:async_hooks";
import { createHttpError } from "../../shared/utils/http-error.js";

const storage = new AsyncLocalStorage();
export const currentTenantScope = () => storage.getStore();
export const runTenantScope = (scope, work) => storage.run({ ...scope }, async () => await work());
export const startTenantRequest = (work) => storage.run({}, work);
export const bindTenantScope = ({ businessId, tenantId }) => {
  if (typeof businessId !== "string" || !businessId || typeof tenantId !== "string" || !tenantId) {
    throw createHttpError({ statusCode: 403, code: "TENANT_CONTEXT_REQUIRED", message: "A verified business context is required" });
  }
  const scope = storage.getStore();
  if (!scope) return; // Direct service calls and maintenance scripts keep their explicit service scopes.
  if (scope.businessId && (scope.businessId !== businessId || scope.tenantId !== tenantId)) {
    throw createHttpError({ statusCode: 403, code: "TENANT_CONTEXT_CONFLICT", message: "A request cannot switch businesses" });
  }
  Object.assign(scope, { businessId, tenantId });
};
