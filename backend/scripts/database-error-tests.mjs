import assert from "node:assert/strict";
import { publicDatabaseError } from "../src/shared/utils/database-error.js";

for (const target of [["businessId", "email"], "User_businessId_email_key"]) {
  const result = publicDatabaseError({ code: "P2002", meta: { target }, message: "SQL and private values" });
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, "EMAIL_EXISTS");
  assert.ok(!JSON.stringify(result).includes("SQL"));
}
assert.equal(publicDatabaseError({ code: "P2002", meta: { target: ["code"] } }).code, "RECORD_ALREADY_EXISTS");
assert.equal(publicDatabaseError({ code: "P2025" }).statusCode, 404);
const unknown = new Error("Database offline");
assert.equal(publicDatabaseError(unknown), unknown, "unknown faults must not become successful or client-error responses");
console.log("Database conflict response tests passed");
