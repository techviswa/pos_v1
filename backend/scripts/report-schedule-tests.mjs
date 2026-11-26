// Scheduled reports cover the last finished period, are sent once per period, and never claim to be emailed
// unless the mail server accepted them.
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { reportSchedules } from "../src/core/reports/reports.service.js";
import { isDue, reportPeriod, runDueSchedules, setReportMailTransport } from "../src/core/reports/report-schedules.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8), id = `sched-${suffix}`, tenantId = `tenant-${id}`, password = randomUUID();
const api = http.createServer(app);
const previousSmtp = { host: process.env.SMTP_HOST, from: process.env.SMTP_FROM };
let base, checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const call = async (method, path, body, session) => {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json().catch(() => null);
  return { status: response.status, data: json?.data ?? json };
};
try {
  await connectDatabase();
  // Periods are finished UTC days.
  const tuesday = new Date("2026-12-01T03:00:00Z");
  eq(reportPeriod("daily", tuesday), { from: "2026-11-30", to: "2026-11-30" });
  eq(reportPeriod("weekly", tuesday), { from: "2026-11-24", to: "2026-11-30" });
  eq(reportPeriod("monthly", tuesday), { from: "2026-11-01", to: "2026-11-30" });
  eq(isDue({ frequency: "daily", active: true, last_period: { to: "2026-11-29" } }, tuesday), true);
  eq(isDue({ frequency: "daily", active: true, last_period: { to: "2026-11-30" } }, tuesday), false, "already sent for yesterday");
  eq(isDue({ frequency: "daily", active: true }, new Date("2026-12-01T01:00:00Z")), false, "waits until the day's figures are final");
  eq(isDue({ frequency: "weekly", active: true }, tuesday), false, "weekly goes on Mondays");
  eq(isDue({ frequency: "monthly", active: true }, tuesday), true, "monthly goes on the 1st");
  eq(isDue({ frequency: "daily", active: false }, tuesday), false, "paused");

  const business = await prisma.business.create({ data: { id, tenantId, name: "Schedule fixture" } });
  const outlet = await prisma.outlet.create({ data: { businessId: id, name: "Main", code: `S${suffix}` } });
  const owner = await usersService.createUser({ businessId: id, tenantId, payload: { email: `o-${id}@t.test`, password, role: "Owner", name: "Owner", profile_required: false } });
  const restricted = await usersService.createUser({ businessId: id, tenantId, payload: { email: `m-${id}@t.test`, password, role: "Cashier", name: "Cashier", profile_required: false, permissions: ["reports"], assigned_outlet_ids: [outlet.id] } });
  // One bill yesterday (in the daily period) and one today (outside it).
  await prisma.bill.create({ data: { businessId: id, customerName: "Yesterday", currency: "INR", subtotal: 100, tax: 18, total: 118, status: "paid", createdAt: new Date("2026-11-30T10:00:00Z"), metadata: { outlet_id: outlet.id } } });
  await prisma.bill.create({ data: { businessId: id, customerName: "Today", currency: "INR", subtotal: 50, tax: 9, total: 59, status: "paid", createdAt: new Date("2026-12-01T01:00:00Z"), metadata: { outlet_id: outlet.id } } });

  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${api.address().port}`;
  const login = async (user) => (await call("POST", "/api/auth/login", { email: user.email, password })).data.session_id;
  const [ownerS, restrictedS] = await Promise.all([owner, restricted].map(login));
  eq((await call("POST", "/api/reports/schedules", { report_key: "nope", frequency: "daily", recipients: ["a@b.co"] }, ownerS)).status, 400);
  eq((await call("POST", "/api/reports/schedules", { report_key: "gst", frequency: "daily", recipients: ["not-an-email"] }, ownerS)).status, 400);
  eq((await call("POST", "/api/reports/schedules", { report_key: "gst", frequency: "daily", recipients: ["a@b.co"] }, restrictedS)).status, 403, "outlet-restricted staff cannot schedule whole-business reports");
  const created = await call("POST", "/api/reports/schedules", { report_key: "gst", format: "csv", frequency: "daily", recipients: "Owner@Cafe.com, accounts@cafe.com" }, ownerS);
  eq(created.status, 201); eq(created.data.recipients, ["owner@cafe.com", "accounts@cafe.com"]);
  const scheduleId = created.data.id;

  // "Run now" downloads the file for the period without claiming anything was sent.
  const download = await call("POST", `/api/reports/schedules/${scheduleId}/run`, {}, ownerS);
  eq(download.status, 200); eq(download.data.status, "downloaded");
  eq((await call("GET", "/api/reports/schedules", null, ownerS)).data[0].last_status, null);

  // Without email settings the background run records that nothing was sent.
  delete process.env.SMTP_HOST; delete process.env.SMTP_FROM;
  eq(await runDueSchedules({ schedules: reportSchedules, now: tuesday }), 1);
  let stored = (await call("GET", "/api/reports/schedules", null, ownerS)).data[0];
  eq([stored.last_status, stored.last_period.to, stored.email_configured], ["not_sent_email_not_configured", "2026-11-30", false]);
  eq(await runDueSchedules({ schedules: reportSchedules, now: tuesday }), 0, "one run per period");

  // With email settings: the report for yesterday only is attached and the status says emailed.
  Object.assign(process.env, { SMTP_HOST: "smtp.test", SMTP_FROM: "pos@test.invalid" });
  const sent = [];
  setReportMailTransport({ sendMail: async (message) => { sent.push(message); return { accepted: [message.to] }; } });
  const wednesday = new Date("2026-12-02T03:00:00Z");
  eq(await runDueSchedules({ schedules: reportSchedules, now: wednesday }), 1);
  eq(sent.length, 1); eq(sent[0].to, "owner@cafe.com, accounts@cafe.com");
  assert.match(sent[0].attachments[0].content, /Today/); checks++;
  assert.doesNotMatch(sent[0].attachments[0].content, /Yesterday/, "only the finished period is reported"); checks++;
  stored = (await call("GET", "/api/reports/schedules", null, ownerS)).data[0];
  eq(stored.last_status, "emailed");
  // A refused email is recorded as a failure, not as sent.
  setReportMailTransport({ sendMail: async () => ({ accepted: [] }) });
  await runDueSchedules({ schedules: reportSchedules, now: new Date("2026-12-03T03:00:00Z") });
  assert.match((await call("GET", "/api/reports/schedules", null, ownerS)).data[0].last_status, /^failed:/); checks++;

  // Pause and delete.
  eq((await call("PUT", `/api/reports/schedules/${scheduleId}`, { active: false }, ownerS)).data.active, false);
  eq(await runDueSchedules({ schedules: reportSchedules, now: new Date("2026-12-04T03:00:00Z") }), 0, "paused schedules are not sent");
  eq((await call("DELETE", `/api/reports/schedules/${scheduleId}`, null, restrictedS)).status, 403);
  eq((await call("DELETE", `/api/reports/schedules/${scheduleId}`, null, ownerS)).status, 200);
  eq((await call("GET", "/api/reports/schedules", null, ownerS)).data.length, 0);
  console.log(`Report schedules passed (${checks} checks): finished periods, once per period, honest email status, validation, outlet restriction, pause and delete.`);
  void business;
} finally {
  setReportMailTransport(null);
  if (previousSmtp.host === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = previousSmtp.host;
  if (previousSmtp.from === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previousSmtp.from;
  if (api.listening) await new Promise((resolve) => api.close(resolve));
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
