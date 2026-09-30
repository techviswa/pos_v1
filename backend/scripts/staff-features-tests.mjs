import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { allocate } from "../src/core/staff/tips.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";
import { saasService } from "../src/core/saas/saas.service.js";

const suffix = randomUUID().slice(0, 8);
const bizA = `staff-a-${suffix}`;
const bizB = `staff-b-${suffix}`;
const scope = (id) => ({ businessId: id, tenantId: `tenant-${id}` });
const server = http.createServer(app);
const HOUR = 60 * 60 * 1000;

const call = async (method, path, { session, body } = {}) => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, data: json?.data ?? json, code: json?.error?.code || json?.code || null };
};
const password = `Pw-${randomUUID()}`;
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password } })).data?.session_id;
const expectStatus = async (promise, status, label) => {
  const result = await promise;
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)?.slice(0, 200)}`);
  return result;
};

try {
  await connectDatabase();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await prisma.business.create({ data: { id: bizA, tenantId: `tenant-${bizA}`, name: "Staff Cafe" } });
  await prisma.business.create({ data: { id: bizB, tenantId: `tenant-${bizB}`, name: "Other Cafe" } });
  const outlet = await prisma.outlet.create({ data: { businessId: bizA, name: "Main", code: `S${suffix}` } });
  await saasService.updateSubscription({ businessId: bizA, payload: { plan: "growth", subscription_status: "active" } });
  const product = await prisma.product.create({ data: { businessId: bizA, name: "Thali", price: 200, category: "Food", stock: 1000 } });

  const make = (role, name, extra = {}) => usersService.createUser({ ...scope(bizA), payload: {
    email: `${name.toLowerCase()}-${suffix}@t.test`, password, role, name, profile_required: false, ...extra } });
  const owner = await make("Owner", "Olga");
  const manager = await make("Manager", "Maya");
  const waiter = await make("Waiter", "Wes", { assigned_outlet_ids: [outlet.id] });
  const chef = await make("Chef", "Chen", { assigned_outlet_ids: [outlet.id] });
  const cashier = await make("Cashier", "Cara", { assigned_outlet_ids: [outlet.id] });
  const outsider = await usersService.createUser({ ...scope(bizB), payload: { email: `bmgr-${suffix}@t.test`, password, role: "Manager", name: "Bo", profile_required: false } });

  // ---------------------------------------------------------------- per-screen permissions
  assert.ok(waiter.permissions.includes("waiter_view") && chef.permissions.includes("kitchen_view"), "role screens are now permissions");
  assert.ok(manager.permissions.includes("manager_view") && manager.permissions.includes("attendance") && manager.permissions.includes("tips"));
  const [ownerS, managerS, waiterS, chefS, cashierS, outsiderS] = await Promise.all(
    [owner, manager, waiter, chef, cashier, outsider].map((user) => login(user.email)));
  assert.ok(ownerS && managerS && waiterS && chefS && cashierS && outsiderS, "everyone can sign in");

  const meta = await expectStatus(call("GET", "/api/staff/metadata/access", { session: waiterS }), 200, "access metadata");
  assert.equal(meta.data.labels.kitchen_view, "Kitchen screen");

  await expectStatus(call("GET", "/api/reservations", { session: waiterS }), 200, "waiter screen lists reservations");
  await expectStatus(call("GET", "/api/reservations", { session: chefS }), 403, "chef has no reservations screen");
  await expectStatus(call("GET", "/api/public/qr/inbox", { session: waiterS }), 200, "waiter sees the QR inbox");
  await expectStatus(call("GET", "/api/public/qr/inbox", { session: cashierS }), 403, "cashier does not");

  // Revoking a screen takes effect immediately; granting one opens it without changing the role.
  await expectStatus(call("PUT", `/api/staff/${waiter.id}/permissions`, { session: ownerS, body: { permissions: ["billing", "bills"] } }), 200, "revoke");
  await expectStatus(call("GET", "/api/reservations", { session: waiterS }), 403, "revoked waiter screen");
  await expectStatus(call("PUT", `/api/staff/${waiter.id}/permissions`, { session: ownerS, body: { permissions: ["billing", "bills", "waiter_view"] } }), 200, "restore");
  const rule = { name: "Tea time", discount_type: "percent_off", value: 10, start_time: "15:00", end_time: "17:00" };
  await expectStatus(call("POST", "/api/price-rules", { session: cashierS, body: rule }), 403, "happy hours need price_rules");
  await expectStatus(call("PUT", `/api/staff/${cashier.id}/permissions`, { session: ownerS, body: { permissions: ["billing", "bills", "price_rules", "staff"] } }), 200, "grant");
  await expectStatus(call("POST", "/api/price-rules", { session: cashierS, body: rule }), 201, "granted price_rules");

  // A non-manager given the Staff screen manages floor roles only, and only with screens they hold.
  await expectStatus(call("GET", "/api/staff", { session: cashierS }), 200, "staff screen list");
  await expectStatus(call("POST", "/api/staff", { session: cashierS, body: { email: `mgr2-${suffix}@t.test`, password, role: "Manager", name: "M2", permissions: ["billing"] } }), 403, "cannot mint a manager");
  await expectStatus(call("PUT", `/api/staff/${manager.id}`, { session: cashierS, body: { name: "Hijacked" } }), 403, "cannot edit a manager");
  await expectStatus(call("POST", "/api/staff", { session: cashierS, body: { email: `w2-${suffix}@t.test`, password, role: "Waiter", name: "W2", permissions: ["billing", "kitchen_view"] } }), 403, "cannot grant unheld screens");
  await expectStatus(call("POST", "/api/staff", { session: cashierS, body: { email: `w2-${suffix}@t.test`, password, role: "Waiter", name: "W2", permissions: ["billing"] } }), 201, "can add a waiter");
  await expectStatus(call("POST", "/api/auth/invites", { session: cashierS, body: { email: `inv-${suffix}@t.test`, role: "Manager" } }), 403, "cannot invite a manager");

  // ---------------------------------------------------------------- attendance
  const clockIn = await expectStatus(call("POST", "/api/attendance/clock-in", { session: waiterS, body: {} }), 201, "clock in");
  assert.equal(clockIn.data.outlet_id, outlet.id, "a person with one outlet clocks in there");
  assert.equal((await call("POST", "/api/attendance/clock-in", { session: waiterS, body: {} })).code, "ALREADY_CLOCKED_IN");
  await expectStatus(call("POST", "/api/attendance/break/start", { session: waiterS }), 200, "break");
  assert.equal((await call("POST", "/api/attendance/break/start", { session: waiterS })).code, "ALREADY_ON_BREAK");
  await expectStatus(call("POST", "/api/attendance/break/end", { session: waiterS }), 200, "break end");
  await expectStatus(call("POST", "/api/attendance/break/start", { session: waiterS }), 200, "second break");
  const out = await expectStatus(call("POST", "/api/attendance/clock-out", { session: waiterS, body: { note: "done" } }), 200, "clock out");
  assert.ok(out.data.breaks.every((row) => row.end_at), "clocking out ends the running break");
  assert.equal((await call("POST", "/api/attendance/clock-out", { session: waiterS })).code, "NOT_CLOCKED_IN");
  const mine = await expectStatus(call("GET", "/api/attendance/me", { session: waiterS }), 200, "my hours");
  assert.equal(mine.data.entries.length, 1);
  assert.equal(mine.data.open_entry, null);

  // Simultaneous taps create exactly one open shift.
  const racing = await Promise.all(Array.from({ length: 5 }, () => call("POST", "/api/attendance/clock-in", { session: chefS, body: {} })));
  assert.equal(racing.filter((result) => result.status === 201).length, 1, "one clock-in wins");
  assert.equal(await prisma.attendanceEntry.count({ where: { userId: chef.id, clockOutAt: null } }), 1);
  await expectStatus(call("POST", "/api/attendance/clock-out", { session: chefS }), 200, "chef out");
  await expectStatus(call("POST", "/api/attendance/clock-in", { session: outsiderS, body: { outlet_id: outlet.id } }), 404, "another business's outlet");

  // Shared PIN clock.
  const kiosk = (body) => call("POST", "/api/attendance/kiosk", { session: cashierS, body });
  assert.equal((await kiosk({ user_id: chef.id, pin: "4826", action: "clock_in" })).code, "PIN_NOT_SET");
  assert.equal((await call("PUT", "/api/attendance/me/pin", { session: chefS, body: { current_password: "wrong", pin: "4826" } })).code, "CURRENT_PASSWORD_INCORRECT");
  assert.equal((await call("PUT", "/api/attendance/me/pin", { session: chefS, body: { current_password: password, pin: "1234" } })).code, "PIN_TOO_SIMPLE");
  assert.equal((await call("PUT", "/api/attendance/me/pin", { session: chefS, body: { current_password: password, pin: "12a4" } })).code, "PIN_INVALID");
  await expectStatus(call("PUT", "/api/attendance/me/pin", { session: chefS, body: { current_password: password, pin: "4826" } }), 200, "set pin");
  for (let attempt = 1; attempt <= 4; attempt += 1) assert.equal((await kiosk({ user_id: chef.id, pin: "0000", action: "clock_in" })).code, "PIN_WRONG");
  assert.equal((await kiosk({ user_id: chef.id, pin: "0000", action: "clock_in" })).code, "PIN_LOCKED", "fifth wrong PIN locks");
  assert.equal((await kiosk({ user_id: chef.id, pin: "4826", action: "clock_in" })).code, "PIN_LOCKED", "even the right PIN waits");
  await expectStatus(call("PUT", `/api/attendance/staff/${chef.id}/pin`, { session: waiterS, body: { pin: "5937" } }), 403, "waiter cannot set PINs");
  await expectStatus(call("PUT", `/api/attendance/staff/${owner.id}/pin`, { session: managerS, body: { pin: "5937" } }), 403, "manager cannot set an owner's PIN");
  await expectStatus(call("PUT", `/api/attendance/staff/${chef.id}/pin`, { session: managerS, body: { pin: "5937" } }), 200, "manager resets PIN");
  const viaPin = await expectStatus(kiosk({ user_id: chef.id, pin: "5937", action: "clock_in" }), 200, "clock in by PIN");
  assert.equal(viaPin.data.source, "pin");
  assert.equal((await kiosk({ user_id: outsider.id, pin: "5937", action: "clock_in" })).code, "STAFF_NOT_FOUND", "no cross-business PIN clock");
  const team = await expectStatus(call("GET", "/api/attendance/team", { session: waiterS }), 200, "team");
  assert.equal(team.data.find((row) => row.id === chef.id).clocked_in, true);
  assert.ok(!team.data.some((row) => row.id === outsider.id));
  assert.ok(!("clockPinHash" in team.data[0]) && team.data.find((row) => row.id === chef.id).has_pin);
  await expectStatus(kiosk({ user_id: chef.id, pin: "5937", action: "clock_out" }), 200, "clock out by PIN");

  // Manager corrections: reason required, audit trail kept, no editing your own hours, no overlaps.
  await expectStatus(call("GET", "/api/attendance/entries", { session: waiterS }), 403, "waiter has no team view");
  const now = Date.now();
  const add = (session, body) => call("POST", "/api/attendance/entries", { session, body });
  const waiterShift = { user_id: waiter.id, outlet_id: outlet.id, clock_in_at: new Date(now - 6 * HOUR).toISOString(), clock_out_at: new Date(now - 4 * HOUR).toISOString() };
  assert.equal((await add(managerS, waiterShift)).code, "REASON_REQUIRED");
  const added = await expectStatus(add(managerS, { ...waiterShift, reason: "forgot to clock in" }), 201, "manual shift");
  assert.equal(added.data.worked_minutes, 120);
  assert.equal(added.data.edits[0].reason, "forgot to clock in");
  assert.equal((await add(managerS, { ...waiterShift, clock_in_at: new Date(now - 5 * HOUR).toISOString(), reason: "dup" })).code, "ATTENDANCE_OVERLAP");
  assert.equal((await add(managerS, { ...waiterShift, clock_out_at: new Date(now - 7 * HOUR).toISOString(), reason: "x" })).code, "ATTENDANCE_TIME_INVALID");
  assert.equal((await add(managerS, { ...waiterShift, clock_out_at: new Date(now + 2 * HOUR).toISOString(), reason: "x" })).code, "ATTENDANCE_TIME_IN_FUTURE");
  assert.equal((await add(managerS, { user_id: manager.id, clock_in_at: waiterShift.clock_in_at, clock_out_at: waiterShift.clock_out_at, reason: "me" })).code, "ATTENDANCE_SELF_EDIT");
  await expectStatus(add(managerS, { user_id: chef.id, outlet_id: outlet.id, clock_in_at: new Date(now - 9 * HOUR).toISOString(),
    clock_out_at: new Date(now - 4 * HOUR).toISOString(), breaks: [{ start_at: new Date(now - 7 * HOUR).toISOString(), end_at: new Date(now - 6 * HOUR).toISOString() }], reason: "paper sheet" }), 201, "chef shift with a break");
  assert.equal((await call("PUT", `/api/attendance/entries/${added.data.id}`, { session: outsiderS, body: { reason: "x", note: "y" } })).status, 404, "other business");
  const edited = await expectStatus(call("PUT", `/api/attendance/entries/${added.data.id}`, { session: managerS, body: { note: "checked", reason: "note" } }), 200, "edit");
  assert.equal(edited.data.edits.length, 2);
  assert.equal(edited.data.edits[1].before.clock_in_at, waiterShift.clock_in_at);
  const summary = await expectStatus(call("GET", `/api/attendance/summary?from=${new Date(now - 24 * HOUR).toISOString()}&to=${new Date(now + 60000).toISOString()}`, { session: managerS }), 200, "summary");
  assert.equal(summary.data.staff.find((row) => row.user_id === chef.id).worked_minutes, 240, "5 hours minus a 1 hour break");
  const scratch = await expectStatus(add(managerS, { user_id: cashier.id, clock_in_at: new Date(now - 30 * HOUR).toISOString(), clock_out_at: new Date(now - 29 * HOUR).toISOString(), reason: "test" }), 201, "scratch");
  await expectStatus(call("DELETE", `/api/attendance/entries/${scratch.data.id}`, { session: managerS, body: { reason: "entered by mistake" } }), 200, "soft delete");
  assert.ok(await prisma.attendanceEntry.findUnique({ where: { id: scratch.data.id } }), "deleted shifts are kept for audit");

  // ---------------------------------------------------------------- shift swaps are stored, not kept in memory
  const swap = await expectStatus(call("POST", "/api/shift-swaps", { session: waiterS, body: { target_staff_id: chef.id, note: "Sunday" } }), 201, "swap request");
  assert.equal((await call("PUT", `/api/shift-swaps/${swap.data.id}`, { session: waiterS, body: { status: "approved" } })).status, 403, "requester cannot approve");
  const decided = await expectStatus(call("PUT", `/api/shift-swaps/${swap.data.id}`, { session: managerS, body: { status: "approved" } }), 200, "manager approves");
  assert.equal(decided.data.decided_by, manager.id);
  const stored = await prisma.stateDocument.findUnique({ where: { key: `shift-swaps:${bizA}` } });
  assert.equal(stored.data[0].status, "approved", "the decision survives a restart");
  assert.equal((await call("GET", "/api/shift-swaps", { session: chefS })).data.length, 0, "others see only their own requests");

  // ---------------------------------------------------------------- tips
  assert.deepEqual([...allocate(10000, [{ key: "a", weight: 1 }, { key: "b", weight: 2 }])].map(([, value]) => value), [3333, 6667]);
  const actor = (user) => ({ id: user.id, name: user.name, role: user.role });
  const bill = (user, payload) => billingService.createInvoice({ ...scope(bizA), user: actor(user), payload: {
    outlet_id: outlet.id, payment_type: "Cash", items: [{ id: product.id, quantity: 1 }], ...payload } });
  const tipped = await bill(cashier, { tip_amount: 50, tip_staff_id: waiter.id, client_request_id: `tip-${suffix}` });
  assert.equal(tipped.tax, 36, "the tip is not taxed (18% of the 200 food only)");
  assert.equal(tipped.total, 286, "200 + 18% GST + 50 tip");
  assert.equal(tipped.paid_amount, 286, "the tip is paid with the bill");
  assert.equal(tipped.tip_staff_name, "Wes");
  const replay = await bill(cashier, { tip_amount: 50, tip_staff_id: waiter.id, client_request_id: `tip-${suffix}` });
  assert.equal(replay.id, tipped.id);
  assert.equal(await prisma.tip.count({ where: { billId: tipped.id } }), 1, "a replayed bill does not record the tip twice");
  const fails = async (promise) => { try { await promise; return null; } catch (error) { return error.code; } };
  assert.equal(await fails(bill(cashier, { tip_amount: 10, tip_staff_id: outsider.id })), "TIP_RECIPIENT_INVALID");
  assert.equal(await fails(bill(cashier, { tip_amount: -5 })), "TIP_AMOUNT_INVALID");
  assert.equal(await fails(bill(cashier, { tip_amount: 20000 })), "TIP_AMOUNT_INVALID");
  await bill(cashier, { tip_amount: 100 }); // pooled
  const unpaid = await bill(cashier, { tip_amount: 30, payment_type: "Due" });
  assert.equal(unpaid.payment_status, "unpaid");
  const voided = await bill(cashier, { tip_amount: 40, payment_type: "Due" });
  await billingService.requestVoid({ ...scope(bizA), invoiceId: voided.id, reason: "wrong table", user: actor(cashier) });
  await billingService.approveVoid({ ...scope(bizA), invoiceId: voided.id, user: actor(manager) });

  await expectStatus(call("POST", "/api/tips/declare", { session: waiterS, body: { amount: 20, note: "cash at the door" } }), 201, "declare own");
  await expectStatus(call("POST", "/api/tips/declare", { session: waiterS, body: { amount: 20, user_id: chef.id } }), 403, "cannot declare for others");
  await expectStatus(call("POST", "/api/tips/declare", { session: waiterS, body: { amount: -1 } }), 400, "bad amount");
  await expectStatus(call("GET", "/api/tips/summary", { session: waiterS }), 403, "waiter has no tips screen");

  const range = `from=${encodeURIComponent(new Date(now - 24 * HOUR).toISOString())}&to=${encodeURIComponent(new Date(now + 10 * 60000).toISOString())}`;
  const tipsSummary = await expectStatus(call("GET", `/api/tips/summary?${range}`, { session: managerS }), 200, "tips summary");
  const rowFor = (id) => tipsSummary.data.staff.find((row) => row.user_id === id);
  assert.equal(tipsSummary.data.totals.pooled, 100);
  assert.equal(tipsSummary.data.totals.pending, 30, "unpaid bill's tip waits");
  assert.equal(tipsSummary.data.totals.cancelled, 40, "voided bill's tip does not count");
  assert.equal(rowFor(waiter.id).direct, 50);
  assert.equal(rowFor(waiter.id).declared, 20);
  assert.equal(rowFor(waiter.id).pool_share, 33.33, "pool split by hours: waiter 2h");
  assert.equal(rowFor(chef.id).pool_share, 66.67, "chef 4h");
  assert.equal(rowFor(manager.id), undefined, "managers are outside the pool by default");
  assert.equal(rowFor(waiter.id).balance, 103.33);

  const payoutBody = { user_id: waiter.id, from: new Date(now - 24 * HOUR).toISOString(), to: new Date(now + 10 * 60000).toISOString(), method: "Cash", client_request_id: `pay-${suffix}` };
  assert.equal((await call("POST", "/api/tips/payouts", { session: managerS, body: { ...payoutBody, amount: 200 } })).code, "PAYOUT_EXCEEDS_BALANCE");
  const paid = await expectStatus(call("POST", "/api/tips/payouts", { session: managerS, body: { ...payoutBody, amount: 103.33 } }), 201, "pay out");
  const again = await expectStatus(call("POST", "/api/tips/payouts", { session: managerS, body: { ...payoutBody, amount: 103.33 } }), 201, "replay");
  assert.equal(again.data.id, paid.data.id, "a retried payout is not paid twice");
  assert.equal((await call("POST", "/api/tips/payouts", { session: managerS, body: { ...payoutBody, client_request_id: `pay2-${suffix}`, amount: 1 } })).code, "PAYOUT_EXCEEDS_BALANCE");
  assert.equal((await call("POST", "/api/tips/payouts", { session: managerS, body: { ...payoutBody, from: new Date(now - 23 * HOUR).toISOString(), client_request_id: `pay3-${suffix}`, amount: 1 } })).code, "PAYOUT_PERIOD_OVERLAP");
  const myTips = await expectStatus(call("GET", `/api/tips/me?${range}`, { session: waiterS }), 200, "my tips");
  assert.equal(myTips.data.balance, 0);
  assert.equal(myTips.data.payouts.length, 1);
  await expectStatus(call("POST", `/api/tips/payouts/${paid.data.id}/void`, { session: managerS, body: { reason: "paid by bank instead" } }), 200, "void payout");
  const afterVoid = await call("GET", `/api/tips/summary?${range}`, { session: managerS });
  assert.equal(afterVoid.data.staff.find((row) => row.user_id === waiter.id).balance, 103.33);

  // Reassigning and voiding tips.
  const pooledTip = afterVoid.data.tips.find((tip) => tip.pooled && tip.state === "counted");
  await expectStatus(call("PUT", `/api/tips/${pooledTip.id}/recipient`, { session: managerS, body: { user_id: chef.id } }), 200, "reassign");
  const afterReassign = await call("GET", `/api/tips/summary?${range}`, { session: managerS });
  assert.equal(afterReassign.data.staff.find((row) => row.user_id === chef.id).direct, 100);
  await expectStatus(call("POST", `/api/tips/${pooledTip.id}/void`, { session: managerS, body: {} }), 400, "void needs a reason");
  await expectStatus(call("POST", `/api/tips/${pooledTip.id}/void`, { session: managerS, body: { reason: "test" } }), 200, "void tip");
  await expectStatus(call("PUT", `/api/tips/${pooledTip.id}/recipient`, { session: outsiderS, body: { user_id: chef.id } }), 404, "another business cannot see this tip");
  const drawer = await billingService.getCashDrawerReport({ ...scope(bizA), outletId: outlet.id });
  assert.ok(drawer.tips_collected >= 150, "the drawer report shows tips collected");

  console.log("Staff features passed: screen permissions, floor-role delegation, clock in/out/breaks, PIN clock lockout, audited corrections, tips (tax, pooling by hours, pending/void, payouts without double payment)");
} finally {
  await prisma.business.deleteMany({ where: { id: { in: [bizA, bizB] } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { in: [`shift-swaps:${bizA}`, `staff-settings:${bizA}`] } } }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await stopRealtime();
  await prisma.$disconnect();
}
