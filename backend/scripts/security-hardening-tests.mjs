import assert from "node:assert/strict";
import { createRateLimiter } from "../src/shared/middleware/rateLimit.middleware.js";
import { safeEqual } from "../src/shared/middleware/authGuard.middleware.js";
import { getProductionConfigIssues } from "../src/config/env.js";

const run = (limiter, req) => {
  const out = [];
  const res = { headers: {}, set(k, v) { this.headers[k] = v; } };
  limiter(req, res, (err) => out.push(err ? err.statusCode : 200));
  return { status: out[0], res };
};

const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
assert.equal(run(limiter, { ip: "1.1.1.1" }).status, 200);
assert.equal(run(limiter, { ip: "1.1.1.1" }).status, 200);
const blocked = run(limiter, { ip: "1.1.1.1" });
assert.equal(blocked.status, 429);
assert.ok(Number(blocked.res.headers["Retry-After"]) >= 1);
assert.equal(run(limiter, { ip: "2.2.2.2" }).status, 200, "other clients are unaffected");

assert.equal(safeEqual("secret", "secret"), true);
assert.equal(safeEqual("secret", "secreT"), false);
assert.equal(safeEqual("short", "longer-value"), false);
assert.equal(safeEqual("", ""), false, "empty keys never authenticate");

const base = {
  nodeEnv: "production",
  auth: { adminEmail: "ops@example.com", adminPassword: "x".repeat(20) },
  corsOrigins: ["https://pos.example.com"],
  admincore: { enabled: true, apiKey: "k".repeat(40), posBaseUrl: "https://api.example.com" },
  database: { url: "postgresql://u:p@db.example.com/pos" },
};
assert.deepEqual(getProductionConfigIssues(base), []);
assert.ok(getProductionConfigIssues({ ...base, corsOrigins: "*" }).length >= 1);
assert.ok(getProductionConfigIssues({ ...base, auth: { ...base.auth, adminPassword: "admin123" } }).length >= 1);
assert.deepEqual(getProductionConfigIssues({ ...base, nodeEnv: "development", corsOrigins: "*" }), []);
assert.deepEqual(getProductionConfigIssues({ ...base, marketing: { encryptionKey: "m".repeat(40) } }), []);
assert.ok(getProductionConfigIssues({ ...base, marketing: { encryptionKey: "short" } }).some((issue) => issue.includes("SECRETS_ENCRYPTION_KEY")));

console.log("security hardening tests passed");
process.exit(0);
