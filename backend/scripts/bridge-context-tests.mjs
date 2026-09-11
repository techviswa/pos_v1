import assert from "node:assert/strict";
import { resolveBridgeContext } from "../src/core/admincore/bridge-context.js";

const request = (body = {}, headers = {}) => ({ body, get: (name) => headers[name] });
assert.deepEqual(resolveBridgeContext(request({ business_id: "a", businessId: "a", tenant_id: "tenant-a" },
  { "business_id": "a", "x-tenant-id": "tenant-a" })), { businessId: "a", tenantId: "tenant-a" });
assert.deepEqual(resolveBridgeContext(request({}, { "x-business-id": "a", "x-tenant-id": "tenant-a" })),
  { businessId: "a", tenantId: "tenant-a" });
for (const req of [
  request({ business_id: "a", businessId: "b" }),
  request({ business_id: "a" }, { "x-business-id": "b" }),
  request({ business_id: "a" }, { business_id: "b" }),
  request({ tenant_id: "a", tenantId: "b" }),
  request({ tenant_id: "a" }, { "x-tenant-id": "b" }),
  request({ business_id: { id: "a" } }),
  request({ tenant_id: ["a"] }),
]) assert.throws(() => resolveBridgeContext(req), /Conflicting|nonempty string/);
console.log("Bridge context rejects conflicting aliases, headers and invalid identity types");
