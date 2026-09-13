import assert from "node:assert/strict";
import { normalizeSubmittedPayments } from "../src/core/billing/billing-depth.utils.js";

for (const method of ["UPI", " upi ", "Card", "Gateway", "Bank Transfer"]) {
  const result = normalizeSubmittedPayments([{ amount: 50, method, status: "confirmed" }], { total: 100 });
  assert.equal(result[0].status, "pending_confirmation");
}
assert.equal(normalizeSubmittedPayments([{ amount: 100, method: "Cash" }], { total: 100 })[0].status, "confirmed");
assert.deepEqual(normalizeSubmittedPayments(undefined, { total: 100, fallbackMethod: "Due" }), []);
assert.equal(normalizeSubmittedPayments(undefined, { total: 100, fallbackMethod: "upi" })[0].status, "pending_confirmation");
for (const payments of [[{ amount: 101 }], [{ amount: -1 }], [{ amount: "NaN" }], [null], "invalid"]) {
  assert.throws(() => normalizeSubmittedPayments(payments, { total: 100 }), (error) => error.statusCode === 400);
}
console.log("Incoming payments reject forged confirmation, overpayment and invalid amounts");
