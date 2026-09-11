import assert from "node:assert/strict";
import { authService } from "../src/core/auth/auth.service.js";
import { requirePermission, requireAnyPermission } from "../src/shared/middleware/authGuard.middleware.js";

const original = authService.getCurrentUser;
let user;
authService.getCurrentUser = async () => user;
const execute = async (middleware) => {
  let result;
  const req = { headers: {}, query: {}, body: {}, get: () => undefined, context: {} };
  await middleware(req, {}, (error) => { result = error || null; });
  return result;
};
try {
  user = { role: "Cashier", permissions: [], tenantId: "tenant-test", business_id: "business-test" };
  assert.equal((await execute(requirePermission("billing")))?.statusCode, 403, "Revoked cashier billing must be denied");
  assert.equal((await execute(requireAnyPermission("billing", "bills")))?.statusCode, 403, "Empty staff grants must deny any-permission checks");
  user.permissions = ["billing"];
  assert.equal(await execute(requirePermission("billing")), null);
  assert.equal((await execute(requirePermission("billing", "reports")))?.statusCode, 403, "Every required grant must be present");
  user.role = "Owner";
  user.permissions = [];
  assert.equal(await execute(requirePermission("billing")), null);
  user = null;
  assert.equal((await execute(requirePermission("billing")))?.statusCode, 401, "Anonymous access must be denied");
  console.log("Staff revocation, explicit grants, owner access and anonymous rejection passed");
} finally { authService.getCurrentUser = original; }
