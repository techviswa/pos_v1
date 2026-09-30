import assert from "node:assert/strict";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { assertTenantAccess } from "../src/shared/middleware/authGuard.middleware.js";
import { qrOrderingService } from "../src/features/sales-extensions/qr-ordering/qr-ordering.service.js";

const businessId = `lifecycle-${Date.now()}`;
const tenantId = `tenant-${businessId}`;
const member = { id: "u1", role: "Owner" };
const check = (method = "GET", url = "/api/orders", user = member) => assertTenantAccess({ user, businessId, method, url });
const code = async (promise) => {
  try { await promise; return null; } catch (error) { return `${error.statusCode}:${error.code}`; }
};
const setStatus = (subscription_status) => saasService.updateSubscription({ businessId, payload: { subscription_status } });

const originalEnv = env.nodeEnv;
const originalResolve = qrOrderingService.resolveContext;
try {
  await prisma.business.create({ data: { id: businessId, tenantId, name: "Lifecycle test" } });

  // No stored state yet: legacy tenants behave as trialing and keep full access.
  assert.equal(await code(check("POST")), null);

  await setStatus("active");
  assert.equal(await code(check("POST")), null);
  await setStatus("past_due");
  assert.equal(await code(check("POST")), null, "past_due is a grace state, not a lockout");

  await setStatus("suspended");
  assert.equal(await code(check("GET")), "403:TENANT_SUSPENDED");
  assert.equal(await code(check("POST")), "403:TENANT_SUSPENDED");
  assert.equal(await code(check("POST", "/api/auth/logout")), null, "suspended users can still sign out");
  assert.equal(await code(check("POST", "/api/orders", { isServiceAccount: true })), null, "AdminCore must be able to reactivate a tenant");
  assert.equal((await saasService.getAccessMode(businessId)).mode, "blocked");

  await setStatus("expired");
  assert.equal(await code(check("GET")), null, "expired tenants keep read access to their data");
  assert.equal(await code(check("POST")), "402:SUBSCRIPTION_INACTIVE");
  assert.equal(await code(check("DELETE")), "402:SUBSCRIPTION_INACTIVE");
  await setStatus("cancelled");
  assert.equal(await code(check("PUT")), "402:SUBSCRIPTION_INACTIVE");

  await setStatus("trial"); // AdminCore spelling is normalised
  assert.equal((await saasService.getAccessMode(businessId)).status, "trialing");
  assert.equal(await code(check("POST")), null, "reactivation takes effect immediately, not after the cache TTL");

  assert.equal(await code(setStatus("banana")), "400:INVALID_SUBSCRIPTION_STATUS");
  assert.equal((await saasService.getAccessMode(businessId)).status, "trialing", "invalid input must not change state");

  // QR phone verification must never hand the code to the caller in production and must resist brute force.
  qrOrderingService.resolveContext = async () => ({ businessId, business: { name: "Lifecycle test" } });
  env.nodeEnv = "production";
  assert.equal(await code(qrOrderingService.requestPhoneVerification({ token: "t", phone: "9876543210" })), "501:QR_PHONE_VERIFICATION_UNAVAILABLE");
  env.nodeEnv = "development";
  const issued = await qrOrderingService.requestPhoneVerification({ token: "t", phone: "9876543210" });
  assert.match(issued.dev_otp, /^\d{6}$/);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const wrong = issued.dev_otp === "000000" ? "111111" : "000000";
    assert.ok(await code(qrOrderingService.verifyPhone({ token: "t", verificationToken: issued.verification_token, otp: wrong })));
  }
  assert.ok(await code(qrOrderingService.verifyPhone({ token: "t", verificationToken: issued.verification_token, otp: issued.dev_otp })),
    "the correct code is refused once the attempt budget is spent");
  const stored = await prisma.stateDocument.findUnique({ where: { key: `qr-otp:${issued.verification_token}` } });
  assert.ok(stored && !JSON.stringify(stored.data).includes(issued.dev_otp), "only a hash of the code is stored");

  const fresh = await qrOrderingService.requestPhoneVerification({ token: "t", phone: "9876543211" });
  const verified = await qrOrderingService.verifyPhone({ token: "t", verificationToken: fresh.verification_token, otp: fresh.dev_otp });
  assert.equal(verified.verified, true);
  const proof = await qrOrderingService.assertPhoneVerified({ businessId, rules: { requirePhoneVerification: true }, customerPhone: "9876543211", verificationToken: fresh.verification_token });
  assert.equal(proof.phone_verified, true);
  assert.ok(await code(qrOrderingService.assertPhoneVerified({ businessId: "other", rules: { requirePhoneVerification: true }, customerPhone: "9876543211", verificationToken: fresh.verification_token })),
    "a verification cannot be reused by another business");
  await qrOrderingService.requestPhoneVerification({ token: "t", phone: "9876543211" });
  await qrOrderingService.requestPhoneVerification({ token: "t", phone: "9876543211" });
  assert.equal(await code(qrOrderingService.requestPhoneVerification({ token: "t", phone: "9876543211" })), "429:QR_VERIFICATION_RATE_LIMITED");

  // With an SMS provider the code goes to the phone and never back to the caller.
  const originalFetch = globalThis.fetch;
  const sent = [];
  Object.assign(process.env, { SMS_PROVIDER: "webhook", SMS_WEBHOOK_URL: "http://sms.test/send" });
  globalThis.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
  try {
    const viaSms = await qrOrderingService.requestPhoneVerification({ token: "t", phone: "9123456789" });
    assert.equal(viaSms.delivery, "sms");
    assert.equal(viaSms.dev_otp, undefined);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.to, "+919123456789");
    assert.match(sent[0].body.message, /\d{6}/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SMS_PROVIDER;
    delete process.env.SMS_WEBHOOK_URL;
  }

  console.log("Tenant lifecycle enforcement and QR phone verification hardening passed");
} finally {
  env.nodeEnv = originalEnv;
  qrOrderingService.resolveContext = originalResolve;
  await prisma.stateDocument.deleteMany({ where: { OR: [{ key: `saas:${businessId}` }, { key: { startsWith: "qr-otp" } }] } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.$disconnect();
}
