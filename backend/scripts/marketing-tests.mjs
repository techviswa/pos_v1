import assert from "node:assert/strict";
import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { setMarketingFetch } from "../src/core/marketing/providers.js";
import { dispatchBatch, inSendWindow, nextWindowStart, processMessage, runScheduler } from "../src/core/marketing/dispatcher.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8);
const bizA = `mkt-a-${suffix}`;
const bizB = `mkt-b-${suffix}`;
const scope = (id) => ({ businessId: id, tenantId: `tenant-${id}` });
const server = http.createServer(app);
const HOUR = 3600000;
const password = `Pw-${randomUUID()}`;
const token = `EAAG-secret-token-${suffix}`;
const appSecret = `app-secret-${suffix}`;
const phoneNumberId = `10${Date.now()}`.slice(0, 16);

// Fake networks: every call is recorded; the reply is chosen per test.
const calls = [];
let reply = () => ({ status: 200, body: { messages: [{ id: `wamid.${randomUUID()}` }] } });
setMarketingFetch(async (url, options) => {
  calls.push({ url, body: options.body, headers: options.headers });
  const { status, body } = reply(url, options);
  return { ok: status >= 200 && status < 300, status, json: async () => body };
});

const call = async (method, path, { session, body, raw, headers = {} } = {}) => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, text, json, data: json?.data ?? json, code: json?.error?.code || null };
};
const ok = async (promise, status, label) => {
  const result = await promise;
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status} ${result.text.slice(0, 240)}`);
  return result;
};
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password } })).data?.session_id;
const istDate = (date = new Date()) => new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 10);
const birthdayToday = () => { const [, m, d] = istDate().split("-"); return new Date(Date.UTC(1990, Number(m) - 1, Number(d), 12)); };

try {
  await connectDatabase();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await prisma.business.create({ data: { id: bizA, tenantId: `tenant-${bizA}`, name: "Spice Route" } });
  await prisma.business.create({ data: { id: bizB, tenantId: `tenant-${bizB}`, name: "Other" } });
  await saasService.updateSubscription({ businessId: bizA, payload: { plan: "growth", subscription_status: "active" } });
  const product = await prisma.product.create({ data: { businessId: bizA, name: "Biryani", price: 300, category: "Food", stock: 1000 } });
  const make = (role, name, business = bizA) => usersService.createUser({ ...scope(business), payload: { email: `${name}-${suffix}@t.test`, password, role, name, profile_required: false } });
  const owner = await make("Owner", "owner");
  const manager = await make("Manager", "manager");
  const outsider = await make("Owner", "outsider", bizB);
  const [ownerS, managerS, outsiderS] = await Promise.all([owner, manager, outsider].map((user) => login(user.email)));

  // Consent: ticked at the till, given on the profile, or never given.
  const cashierActor = { id: owner.id, name: owner.name, role: "Owner" };
  await billingService.createInvoice({ ...scope(bizA), user: cashierActor, payload: { payment_type: "Cash", items: [{ id: product.id, quantity: 1 }], customer_phone: "9000000001", customer_name: "Asha Rao", marketing_opt_in: true } });
  await billingService.createInvoice({ ...scope(bizA), user: cashierActor, payload: { payment_type: "Cash", items: [{ id: product.id, quantity: 1 }], customer_phone: "9000000003", customer_name: "Chris" } });
  const asha = await prisma.customer.findFirst({ where: { businessId: bizA, phone: "9000000001" } });
  assert.equal(asha.marketingOptIn, true, "consent ticked at the till is recorded");
  assert.ok(asha.marketingConsentAt, "with the time it was given");
  assert.equal((await prisma.customer.findFirst({ where: { businessId: bizA, phone: "9000000003" } })).marketingOptIn, false, "no tick, no consent");
  await billingService.createInvoice({ ...scope(bizA), user: cashierActor, payload: { payment_type: "Cash", items: [{ id: product.id, quantity: 1 }], customer_phone: "9000000001", customer_name: "Asha Rao" } });
  assert.equal((await prisma.customer.findFirst({ where: { id: asha.id } })).marketingOptIn, true, "a later bill without the tick does not withdraw consent");
  const ben = await prisma.customer.create({ data: { businessId: bizA, phone: "9000000002", name: "Ben Das", tags: ["VIP"], marketingOptIn: true, marketingConsentAt: new Date(), birthday: birthdayToday() } });
  await prisma.customer.create({ data: { businessId: bizA, phone: "9000000004", name: "Erased", marketingOptIn: true, anonymizedAt: new Date() } });

  // ---------------------------------------------------------------- access and settings
  await ok(call("GET", "/api/marketing/overview", { session: managerS }), 403, "marketing is Owner-only by default");
  const overview = await ok(call("GET", "/api/marketing/overview", { session: ownerS }), 200, "overview");
  assert.equal(overview.data.opted_in, 2);
  await ok(call("PUT", "/api/marketing/settings", { session: ownerS, body: { whatsapp_enabled: true } }), 400, "cannot switch on without credentials");
  await ok(call("PUT", "/api/marketing/settings", { session: ownerS, body: { send_window_start: 420 } }), 400, "no promotions before 09:00");
  const saved = await ok(call("PUT", "/api/marketing/settings", { session: ownerS, body: {
    whatsapp_enabled: true, whatsapp_phone_number_id: phoneNumberId, whatsapp_access_token: token, whatsapp_app_secret: appSecret,
  } }), 200, "connect WhatsApp");
  assert.ok(!saved.text.includes(token) && !saved.text.includes(appSecret), "secrets are never sent back");
  assert.equal(saved.data.whatsapp_access_token_set, true);
  const stored = await prisma.marketingConfig.findUnique({ where: { businessId: bizA } });
  assert.ok(stored.whatsappAccessTokenEnc && !stored.whatsappAccessTokenEnc.includes(token), "stored encrypted");
  await ok(call("PUT", "/api/marketing/settings", { session: outsiderS, body: { whatsapp_phone_number_id: phoneNumberId } }), 409, "one WhatsApp number per business");

  // ---------------------------------------------------------------- templates
  const waBody = { channel: "whatsapp", name: "Weekend offer", whatsapp_template_name: "weekend_offer", language: "en",
    body: "Hi {{1}}, you have {{2}} points at {{3}}. {{4}} this weekend!",
    variables: [{ source: "field", value: "first_name" }, { source: "field", value: "points" }, { source: "field", value: "business_name" }, { source: "text", value: "20% off" }] };
  await ok(call("POST", "/api/marketing/templates", { session: ownerS, body: { ...waBody, variables: waBody.variables.slice(0, 2) } }), 400, "placeholders must all be filled");
  await ok(call("POST", "/api/marketing/templates", { session: ownerS, body: { ...waBody, whatsapp_template_name: "Weekend Offer!" } }), 400, "WhatsApp template names are checked");
  const waTemplate = await ok(call("POST", "/api/marketing/templates", { session: ownerS, body: waBody }), 201, "WhatsApp template");
  const smsBody = { channel: "sms", name: "Birthday SMS", body: "Happy birthday {#var#}! Enjoy a free dessert at {#var#}. -SPICE", variables: [{ source: "field", value: "first_name" }, { source: "field", value: "business_name" }] };
  await ok(call("POST", "/api/marketing/templates", { session: ownerS, body: smsBody }), 400, "SMS needs a DLT template id");
  const smsTemplate = await ok(call("POST", "/api/marketing/templates", { session: ownerS, body: { ...smsBody, dlt_template_id: "1207161234567890123", provider_template_id: "64f0msg91flow" } }), 201, "SMS template");

  const preview = await ok(call("POST", "/api/marketing/preview", { session: ownerS, body: { template_id: waTemplate.data.id, audience: {} } }), 200, "preview");
  assert.equal(preview.data.recipients, 2, "only consented, reachable, not erased guests");
  assert.match(preview.data.sample_text, /^Hi \w+, you have \d+ points at Spice Route\. 20% off this weekend!$/);
  const vipPreview = await ok(call("POST", "/api/marketing/preview", { session: ownerS, body: { template_id: waTemplate.data.id, audience: { tags: ["VIP"] } } }), 200, "segment");
  assert.equal(vipPreview.data.recipients, 1);

  // ---------------------------------------------------------------- one-time campaign over WhatsApp
  const smsCampaign = await ok(call("POST", "/api/marketing/campaigns", { session: ownerS, body: { name: "SMS blast", template_id: smsTemplate.data.id } }), 201, "sms campaign");
  await ok(call("POST", `/api/marketing/campaigns/${smsCampaign.data.id}/schedule`, { session: ownerS, body: {} }), 409, "SMS not connected yet");
  const campaign = await ok(call("POST", "/api/marketing/campaigns", { session: ownerS, body: { name: "Weekend", template_id: waTemplate.data.id } }), 201, "campaign");
  await ok(call("GET", `/api/marketing/campaigns/${campaign.data.id}`, { session: outsiderS }), 404, "other businesses cannot see it");
  const started = await ok(call("POST", `/api/marketing/campaigns/${campaign.data.id}/schedule`, { session: ownerS, body: {} }), 200, "send now");
  assert.equal(started.data.status, "sending");
  assert.equal(await prisma.marketingMessage.count({ where: { campaignId: campaign.data.id } }), 2);

  const config = await prisma.marketingConfig.findUnique({ where: { businessId: bizA } });
  // Use a future open window so campaigns created later in this test are also due.
  const openNow = new Date(nextWindowStart(config).getTime() + 60000);
  // Outside the window a message waits for the window instead of failing.
  const night = new Date(nextWindowStart(config, openNow).getTime() - 3 * HOUR);
  assert.equal(inSendWindow(config, night), false);
  const waiting = await prisma.marketingMessage.findFirst({ where: { campaignId: campaign.data.id } });
  await prisma.marketingMessage.update({ where: { id: waiting.id }, data: { status: "sending", attempts: 1 } });
  const deferred = await processMessage(waiting.id, night);
  assert.equal(deferred.status, "queued");
  assert.equal(deferred.attempts, 0, "waiting for the window is not a failed attempt");
  assert.ok(inSendWindow(config, deferred.nextAttemptAt), "it is retried when the window opens");
  // Keep the retry due at the simulated dispatch time, even on fast CI runners.
  await prisma.marketingMessage.update({ where: { id: waiting.id }, data: { nextAttemptAt: openNow } });

  calls.length = 0;
  const dispatched = await dispatchBatch({ now: openNow });
  assert.equal(dispatched.sent, 2);
  const waCall = JSON.parse(calls[0].body);
  assert.match(calls[0].url, new RegExp(`/${phoneNumberId}/messages$`));
  assert.equal(calls[0].headers.authorization, `Bearer ${token}`);
  assert.equal(waCall.type, "template");
  assert.equal(waCall.template.name, "weekend_offer");
  assert.ok(["919000000001", "919000000002"].includes(waCall.to));
  assert.equal(waCall.template.components[0].parameters.length, 4);
  assert.equal((await prisma.marketingCampaign.findUnique({ where: { id: campaign.data.id } })).status, "completed");
  assert.equal((await dispatchBatch({ now: openNow })).claimed, 0, "nothing is sent twice");

  // ---------------------------------------------------------------- delivery receipts and STOP over the webhook
  const verify = await call("GET", `/api/public/marketing/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${config.whatsappVerifyToken}&hub.challenge=42`);
  assert.equal(verify.status, 200);
  assert.equal(verify.text, "42");
  assert.equal((await call("GET", "/api/public/marketing/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42")).status, 403);
  const sentToBen = await prisma.marketingMessage.findFirst({ where: { campaignId: campaign.data.id, customerId: ben.id } });
  const sentToAsha = await prisma.marketingMessage.findFirst({ where: { campaignId: campaign.data.id, customerId: asha.id } });
  const hook = (value) => {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, ...value } }] }] });
    return { raw, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", appSecret).update(raw).digest("hex")}` } };
  };
  const forged = hook({ statuses: [{ id: sentToBen.providerMessageId, status: "read" }] });
  assert.equal((await call("POST", "/api/public/marketing/whatsapp/webhook", { raw: forged.raw, headers: { "x-hub-signature-256": "sha256=00" } })).status, 401, "unsigned callbacks are refused");
  await ok(call("POST", "/api/public/marketing/whatsapp/webhook", hook({ statuses: [{ id: sentToBen.providerMessageId, status: "delivered" }] })), 200, "delivered");
  await ok(call("POST", "/api/public/marketing/whatsapp/webhook", hook({ statuses: [{ id: sentToBen.providerMessageId, status: "read" }] })), 200, "read");
  await ok(call("POST", "/api/public/marketing/whatsapp/webhook", hook({ statuses: [{ id: sentToBen.providerMessageId, status: "failed", errors: [{ title: "late" }] }] })), 200, "late failure");
  const benMessage = await prisma.marketingMessage.findUnique({ where: { id: sentToBen.id } });
  assert.equal(benMessage.status, "read", "a late failure does not undo a read receipt");
  assert.ok(benMessage.deliveredAt && benMessage.readAt);
  await ok(call("POST", "/api/public/marketing/whatsapp/webhook", hook({ statuses: [{ id: sentToAsha.providerMessageId, status: "failed", errors: [{ title: "Message undeliverable" }] }] })), 200, "failed");
  assert.equal((await prisma.marketingMessage.findUnique({ where: { id: sentToAsha.id } })).status, "failed");
  await ok(call("POST", "/api/public/marketing/whatsapp/webhook", hook({ messages: [{ from: "919000000001", type: "text", text: { body: " stop " } }] })), 200, "STOP");
  const ashaAfter = await prisma.customer.findUnique({ where: { id: asha.id } });
  assert.equal(ashaAfter.marketingOptIn, false, "replying STOP withdraws consent");
  assert.ok(ashaAfter.marketingOptOutAt);
  assert.equal((await call("POST", "/api/marketing/preview", { session: ownerS, body: { template_id: waTemplate.data.id } })).data.recipients, 1);

  // ---------------------------------------------------------------- retries, permanent failures, weekly limit
  await ok(call("PUT", "/api/marketing/settings", { session: ownerS, body: { weekly_cap: 2 } }), 200, "cap 2");
  const second = await ok(call("POST", "/api/marketing/campaigns", { session: ownerS, body: { name: "Second", template_id: waTemplate.data.id } }), 201, "second");
  await ok(call("POST", `/api/marketing/campaigns/${second.data.id}/schedule`, { session: ownerS, body: {} }), 200, "send");
  reply = () => ({ status: 429, body: { error: { code: 130429, message: "Rate limit hit" } } });
  await dispatchBatch({ now: openNow });
  const retried = await prisma.marketingMessage.findFirst({ where: { campaignId: second.data.id } });
  assert.equal(retried.status, "queued", "rate limits are retried");
  assert.equal(retried.sentAt, null, "a failed attempt does not use up the weekly slot");
  assert.match(retried.error, /130429/);
  reply = () => ({ status: 200, body: { messages: [{ id: `wamid.${randomUUID()}` }] } });
  const later = new Date(retried.nextAttemptAt.getTime() + 1000);
  await dispatchBatch({ now: inSendWindow(config, later) ? later : new Date(nextWindowStart(config, later).getTime() + 60000) });
  assert.equal((await prisma.marketingMessage.findUnique({ where: { id: retried.id } })).status, "sent");
  const third = await ok(call("POST", "/api/marketing/campaigns", { session: ownerS, body: { name: "Third", template_id: waTemplate.data.id } }), 201, "third");
  await ok(call("POST", `/api/marketing/campaigns/${third.data.id}/schedule`, { session: ownerS, body: {} }), 200, "send");
  await dispatchBatch({ now: openNow });
  const capped = await prisma.marketingMessage.findFirst({ where: { campaignId: third.data.id } });
  assert.equal(capped.status, "skipped");
  assert.equal(capped.skipReason, "weekly_limit", "at most 2 promotions per person per week");
  await ok(call("PUT", "/api/marketing/settings", { session: ownerS, body: { weekly_cap: 14 } }), 200, "raise cap");
  const fourth = await ok(call("POST", "/api/marketing/campaigns", { session: ownerS, body: { name: "Fourth", template_id: waTemplate.data.id } }), 201, "fourth");
  await ok(call("POST", `/api/marketing/campaigns/${fourth.data.id}/schedule`, { session: ownerS, body: {} }), 200, "send");
  reply = () => ({ status: 400, body: { error: { code: 131026, message: "Message undeliverable" } } });
  await dispatchBatch({ now: openNow });
  const undeliverable = await prisma.marketingMessage.findFirst({ where: { campaignId: fourth.data.id } });
  assert.equal(undeliverable.status, "failed", "permanent errors are not retried");
  reply = () => ({ status: 200, body: { messages: [{ id: `wamid.${randomUUID()}` }] } });

  // ---------------------------------------------------------------- scheduling and cancelling
  const later1 = await ok(call("POST", "/api/marketing/campaigns", { session: ownerS, body: { name: "Tonight", template_id: waTemplate.data.id } }), 201, "later");
  const sendAt = new Date(Date.now() + HOUR);
  const scheduled = await ok(call("POST", `/api/marketing/campaigns/${later1.data.id}/schedule`, { session: ownerS, body: { send_at: sendAt.toISOString() } }), 200, "schedule");
  assert.equal(scheduled.data.status, "scheduled");
  assert.equal(await prisma.marketingMessage.count({ where: { campaignId: later1.data.id } }), 0, "recipients are fixed when it starts");
  await runScheduler(new Date(sendAt.getTime() + 60000));
  assert.equal((await prisma.marketingCampaign.findUnique({ where: { id: later1.data.id } })).status, "sending");
  await ok(call("POST", `/api/marketing/campaigns/${later1.data.id}/cancel`, { session: ownerS }), 200, "cancel");
  assert.equal((await prisma.marketingMessage.findFirst({ where: { campaignId: later1.data.id } })).skipReason, "cancelled");

  // ---------------------------------------------------------------- SMS (MSG91) birthday automation
  await ok(call("PUT", "/api/marketing/settings", { session: ownerS, body: { sms_enabled: true, sms_provider: "msg91", sms_sender_id: "SPICER", sms_dlt_entity_id: "1201160000000000001", sms_credentials: { auth_key: "msg91-key" } } }), 200, "connect SMS");
  const birthday = await ok(call("POST", "/api/marketing/campaigns", { session: ownerS, body: { name: "Birthdays", kind: "birthday", template_id: smsTemplate.data.id, send_hour: 0 } }), 201, "automation");
  assert.equal(birthday.data.status, "paused");
  await ok(call("POST", `/api/marketing/campaigns/${birthday.data.id}/automation`, { session: ownerS, body: { active: true } }), 200, "switch on");
  await runScheduler();
  await runScheduler();
  const birthdayMessages = await prisma.marketingMessage.findMany({ where: { campaignId: birthday.data.id } });
  assert.equal(birthdayMessages.length, 1, "Ben's birthday, once per day however often the scheduler runs");
  assert.equal(birthdayMessages[0].runKey, istDate());
  calls.length = 0;
  reply = (url) => (url.includes("msg91") ? { status: 200, body: { type: "success", message: "req-555" } } : { status: 500, body: {} });
  await dispatchBatch({ now: openNow });
  const msg91 = JSON.parse(calls[0].body);
  assert.equal(calls[0].headers.authkey, "msg91-key");
  assert.equal(msg91.template_id, "64f0msg91flow");
  assert.deepEqual(msg91.recipients[0], { mobiles: "919000000002", var1: "Ben", var2: "Spice Route" });
  const smsSent = await prisma.marketingMessage.findFirst({ where: { campaignId: birthday.data.id } });
  assert.equal(smsSent.body, "Happy birthday Ben! Enjoy a free dessert at Spice Route. -SPICE");
  await ok(call("POST", `/api/public/marketing/sms/status/${config.smsWebhookKey}`, { body: { requestId: "req-555", status: "DELIVRD" } }), 200, "SMS receipt");
  assert.equal((await prisma.marketingMessage.findUnique({ where: { id: smsSent.id } })).status, "delivered");
  await ok(call("POST", "/api/public/marketing/sms/status/wrong-key", { body: { requestId: "req-555", status: "failed" } }), 404, "unknown key");
  await ok(call("POST", `/api/public/marketing/sms/inbound/${config.smsWebhookKey}`, { raw: "From=%2B919000000002&Body=STOP", headers: { "content-type": "application/x-www-form-urlencoded" } }), 200, "SMS STOP (Twilio form)");
  assert.equal((await prisma.customer.findUnique({ where: { id: ben.id } })).marketingOptIn, false);
  await ok(call("POST", `/api/public/marketing/sms/inbound/${config.smsWebhookKey}`, { body: { from: "9000000002", text: "START" } }), 200, "START");
  assert.equal((await prisma.customer.findUnique({ where: { id: ben.id } })).marketingOptIn, true, "START gives consent again");

  // ---------------------------------------------------------------- report with returning guests, test send
  const returnVisit = await billingService.createInvoice({ ...scope(bizA), user: cashierActor, payload: { payment_type: "Cash", items: [{ id: product.id, quantity: 2 }], customer_phone: "9000000002", customer_name: "Ben Das" } });
  // The return visit must follow the simulated send, including when run overnight.
  await prisma.bill.update({ where: { id: returnVisit.id }, data: { createdAt: new Date(openNow.getTime() + HOUR) } });
  const report = await ok(call("GET", `/api/marketing/campaigns/${campaign.data.id}`, { session: ownerS }), 200, "report");
  assert.equal(report.data.counts.read, 1);
  assert.equal(report.data.counts.failed, 1);
  assert.equal(report.data.attribution.customers_returned, 1, "Ben came back within 7 days");
  assert.ok(report.data.attribution.revenue >= 600);
  assert.ok(report.data.messages.every((row) => row.phone.startsWith("******")), "phone numbers are masked in reports");
  calls.length = 0;
  reply = () => ({ status: 200, body: { messages: [{ id: "wamid.test" }] } });
  const test = await ok(call("POST", "/api/marketing/test", { session: ownerS, body: { template_id: waTemplate.data.id, phone: "9876543210" } }), 200, "test send");
  assert.equal(test.data.provider_message_id, "wamid.test");
  reply = () => ({ status: 401, body: { error: { code: 190, message: "expired" } } });
  const expired = await call("POST", "/api/marketing/test", { session: ownerS, body: { template_id: waTemplate.data.id, phone: "9876543210" } });
  assert.equal(expired.status, 502);
  assert.match(expired.json.error.message, /access token is invalid or expired/);

  // Consent withdrawn on the profile screen.
  await ok(call("PUT", `/api/customers/profiles/${ben.id}`, { session: ownerS, body: { marketing_opt_in: false } }), 200, "withdraw");
  assert.ok((await prisma.customer.findUnique({ where: { id: ben.id } })).marketingOptOutAt);

  console.log("Marketing passed: consent capture and withdrawal (till, profile, STOP/START), encrypted credentials, templates, segments, WhatsApp and MSG91 sending, send window, weekly limit, retries, receipts, scheduling, cancelling, birthday automation, attribution");
} finally {
  setMarketingFetch(null);
  await prisma.business.deleteMany({ where: { id: { in: [bizA, bizB] } } }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await stopRealtime();
  await prisma.$disconnect();
}
