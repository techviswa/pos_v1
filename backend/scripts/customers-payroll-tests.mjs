import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { usersService } from "../src/core/users/users.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { amountInWords, calculatePayslip, DEFAULT_PAYROLL_SETTINGS } from "../src/core/staff/payroll.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8);
const bizA = `cust-a-${suffix}`;
const bizB = `cust-b-${suffix}`;
const scope = (id) => ({ businessId: id, tenantId: `tenant-${id}` });
const server = http.createServer(app);
const DAY = 24 * 60 * 60 * 1000;

const call = async (method, path, { session, body } = {}) => {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, data: json?.data ?? json, code: json?.error?.code || json?.code || null };
};
const password = `Pw-${randomUUID()}`;
const login = async (email) => (await call("POST", "/api/auth/login", { body: { email, password } })).data?.session_id;
const ok = async (promise, status, label) => {
  const result = await promise;
  assert.equal(result.status, status, `${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)?.slice(0, 240)}`);
  return result;
};
const failsWith = async (promise) => { try { await promise; return null; } catch (error) { return error.code || `${error.statusCode}`; } };

try {
  await connectDatabase();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await prisma.business.create({ data: { id: bizA, tenantId: `tenant-${bizA}`, name: "Loyal Cafe" } });
  await prisma.business.create({ data: { id: bizB, tenantId: `tenant-${bizB}`, name: "Other Cafe" } });
  await saasService.updateSubscription({ businessId: bizA, payload: { plan: "growth", subscription_status: "active" } });
  const outlet = await prisma.outlet.create({ data: { businessId: bizA, name: "Main", code: `L${suffix}` } });
  const product = await prisma.product.create({ data: { businessId: bizA, name: "Feast", price: 1000, category: "Food", stock: 10000 } });
  const make = (role, name, business = bizA) => usersService.createUser({ ...scope(business), payload: {
    email: `${name.toLowerCase()}-${suffix}@t.test`, password, role, name, profile_required: false } });
  const owner = await make("Owner", "Omar");
  const manager = await make("Manager", "Mira");
  const cashier = await make("Cashier", "Cyrus");
  const waiter = await make("Waiter", "Wanda");
  const chef = await make("Chef", "Chandra");
  const outsider = await make("Manager", "Otto", bizB);
  const [ownerS, managerS, cashierS, waiterS, chefS, outsiderS] = await Promise.all([owner, manager, cashier, waiter, chef, outsider].map((user) => login(user.email)));
  assert.ok(cashier.permissions.includes("gift_cards") && manager.permissions.includes("customers") && !manager.permissions.includes("payroll"));

  const actor = (user) => ({ id: user.id, name: user.name, role: user.role });
  const bill = (payload, by = cashier) => billingService.createInvoice({ ...scope(bizA), user: actor(by), payload: {
    outlet_id: outlet.id, payment_type: "Cash", items: [{ id: product.id, quantity: 1 }], ...payload } });
  const customerRow = () => prisma.customer.findFirst({ where: { businessId: bizA, phone: "9845012345" } });

  // ================================================================ customer profiles and loyalty
  const first = await bill({ customer_phone: "+91 98450 12345", customer_name: "Asha", client_request_id: `c1-${suffix}` });
  assert.equal(first.total, 1180);
  assert.equal(first.loyalty_points_earned, 50, "5% of the 1000 food value, before tax");
  let asha = await customerRow();
  assert.equal(asha.name, "Asha");
  assert.equal(asha.loyaltyPoints, 50);
  assert.equal(asha.visitCount, 1);
  assert.equal(Number(asha.totalSpent), 1180);
  await bill({ customer_phone: "+91 98450 12345", customer_name: "Asha", client_request_id: `c1-${suffix}` });
  assert.equal((await customerRow()).loyaltyPoints, 50, "a replayed bill earns nothing extra");
  await bill({ customer_phone: "098450 12345", customer_name: "Walk-in Customer" });
  asha = await customerRow();
  assert.equal(asha.loyaltyPoints, 100, "the same person whatever the phone format");
  assert.equal(asha.name, "Asha", "a placeholder name never overwrites a real one");

  assert.equal(await failsWith(bill({ customer_phone: "9845012345", loyalty_redeem_points: 50 })), "LOYALTY_BELOW_MINIMUM");
  assert.equal(await failsWith(bill({ loyalty_redeem_points: 100 })), "LOYALTY_CUSTOMER_REQUIRED");
  assert.equal(await failsWith(bill({ customer_phone: "9845012345", loyalty_redeem_points: 101 })), "LOYALTY_INSUFFICIENT");
  const redeemed = await bill({ customer_phone: "9845012345", loyalty_redeem_points: 100 });
  assert.equal(redeemed.loyalty_discount, 100, "1 point = 1 rupee, taken off before tax");
  assert.equal(redeemed.tax, 162, "GST on 900");
  assert.equal(redeemed.total, 1062);
  assert.equal(redeemed.loyalty_points_earned, 45, "earned on what was actually paid for");
  assert.equal((await customerRow()).loyaltyPoints, 45);
  await prisma.customer.update({ where: { id: asha.id }, data: {} });
  await ok(call("POST", `/api/customers/profiles/${asha.id}/points`, { session: managerS, body: { points: 955, reason: "Welcome gift" } }), 200, "adjust");
  assert.equal(await failsWith(bill({ customer_phone: "9845012345", loyalty_redeem_points: 600 })), "LOYALTY_ABOVE_LIMIT", "points pay at most 50%");

  // Earning waits for payment; a void returns redeemed points.
  const due = await bill({ customer_phone: "9845012345", payment_type: "Due", loyalty_redeem_points: 200 });
  assert.equal(due.loyalty_points_earned, 0, "an unpaid bill earns nothing yet");
  assert.equal((await customerRow()).loyaltyPoints, 800);
  const paid = await billingService.addPayment({ ...scope(bizA), invoiceId: due.id, user: actor(cashier), payload: { amount: due.total, method: "Cash" } });
  assert.equal(paid.payment_status, "paid");
  assert.equal(paid.loyalty_points_earned, 40, "earned once paid: 5% of 800");
  assert.equal((await customerRow()).loyaltyPoints, 840);
  const toVoid = await bill({ customer_phone: "9845012345", payment_type: "Due", loyalty_redeem_points: 300 });
  assert.equal((await customerRow()).loyaltyPoints, 540);
  await billingService.requestVoid({ ...scope(bizA), invoiceId: toVoid.id, reason: "mistake", user: actor(cashier) });
  await billingService.approveVoid({ ...scope(bizA), invoiceId: toVoid.id, user: actor(manager) });
  asha = await customerRow();
  assert.equal(asha.loyaltyPoints, 840, "a voided bill gives the points back");
  const visitsBefore = asha.visitCount;
  const spentBefore = Number(asha.totalSpent);

  // A full refund takes back what the bill earned and reduces spend.
  await billingService.refundInvoice({ ...scope(bizA), invoiceId: first.id, user: actor(manager), payload: { amount: 1180, reason: "cold food", method: "Cash" } });
  asha = await customerRow();
  assert.equal(asha.loyaltyPoints, 790, "the 50 earned points are taken back");
  assert.equal(Number(asha.totalSpent), spentBefore - 1180);
  assert.equal(asha.visitCount, visitsBefore);
  assert.equal((await prisma.loyaltyEntry.aggregate({ where: { customerId: asha.id }, _sum: { points: true } }))._sum.points, asha.loyaltyPoints, "the ledger adds up to the balance");

  // Expiry: unused points from an expired lot go; spent ones do not come back to life.
  await prisma.loyaltyEntry.create({ data: { businessId: bizA, customerId: asha.id, type: "adjust", points: 10, balanceAfter: asha.loyaltyPoints + 10, expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 400 * DAY) } });
  await prisma.customer.update({ where: { id: asha.id }, data: { loyaltyPoints: { increment: 10 } } });
  const lookup = await ok(call("GET", "/api/customers/lookup?phone=9845012345", { session: cashierS }), 200, "till lookup");
  assert.equal(lookup.data.customer.loyalty_points, 800, "spending uses the soonest-expiring points first, so that old lot was already spent");
  const ben = await ok(call("POST", "/api/customers/profiles", { session: cashierS, body: { phone: "9000000001", name: "Ben" } }), 201, "new profile");
  await ok(call("POST", `/api/customers/profiles/${ben.data.id}/points`, { session: managerS, body: { points: 300, reason: "promo" } }), 200, "promo points");
  await ok(call("POST", `/api/customers/profiles/${ben.data.id}/points`, { session: managerS, body: { points: 200, reason: "second promo" } }), 200, "more points");
  await ok(call("POST", `/api/customers/profiles/${ben.data.id}/points`, { session: managerS, body: { points: -100, reason: "correction" } }), 200, "take some back");
  const firstLot = await prisma.loyaltyEntry.findFirst({ where: { customerId: ben.data.id, points: 300 } });
  await prisma.loyaltyEntry.update({ where: { id: firstLot.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const benLookup = await ok(call("GET", "/api/customers/lookup?phone=9000000001", { session: cashierS }), 200, "lookup after expiry");
  assert.equal(benLookup.data.customer.loyalty_points, 200, "the unspent 200 of the expired 300-point lot expired; the newer 200 remain");
  assert.equal((await prisma.loyaltyEntry.findFirst({ where: { customerId: ben.data.id, type: "expire" } })).points, -200);

  // Profiles screen and permissions.
  await ok(call("GET", "/api/customers/profiles", { session: waiterS }), 403, "waiter has no customers screen");
  await ok(call("GET", `/api/customers/profiles/${asha.id}`, { session: outsiderS }), 404, "another business");
  const profile = await ok(call("GET", `/api/customers/profiles/${asha.id}`, { session: managerS }), 200, "profile");
  assert.ok(profile.data.bills.length >= 4 && profile.data.favourites[0].name === "Feast");
  assert.ok(profile.data.loyalty_history.some((entry) => entry.type === "reverse_redeem"));
  await ok(call("PUT", `/api/customers/profiles/${asha.id}`, { session: managerS, body: { email: "not-an-email" } }), 400, "bad email");
  await ok(call("PUT", `/api/customers/profiles/${asha.id}`, { session: managerS, body: { birthday: "2999-01-01" } }), 400, "future birthday");
  const today = new Date();
  const bday = `1990-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await ok(call("PUT", `/api/customers/profiles/${asha.id}`, { session: managerS, body: { birthday: bday, tags: ["VIP", "VIP", "veg"], marketing_opt_in: true } }), 200, "edit");
  const celebrating = await ok(call("GET", "/api/customers/profiles?celebrations=7", { session: managerS }), 200, "celebrations");
  assert.ok(celebrating.data.some((row) => row.id === asha.id && row.birthday_in_days === 0));
  await ok(call("POST", "/api/customers/profiles", { session: cashierS, body: { phone: "98450-12345", name: "Dup" } }), 409, "one profile per phone");
  await ok(call("PUT", "/api/customers/settings", { session: cashierS, body: { loyalty: { earn_percent: 50 } } }), 403, "programme rules need a manager");
  await ok(call("PUT", "/api/customers/settings", { session: managerS, body: { loyalty: { earn_percent: 90 } } }), 400, "earn percent is capped");

  // ================================================================ gift cards
  const sold = await ok(call("POST", "/api/customers/gift-cards", { session: cashierS, body: { amount: 500, payment_method: "Cash", recipient_name: "Ravi", customer_phone: "9845012345", outlet_id: outlet.id, client_request_id: `gc-${suffix}` } }), 201, "sell");
  assert.equal(sold.data.status, "active");
  assert.match(sold.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const again = await ok(call("POST", "/api/customers/gift-cards", { session: cashierS, body: { amount: 500, payment_method: "Cash", outlet_id: outlet.id, client_request_id: `gc-${suffix}` } }), 201, "replay");
  assert.equal(again.data.id, sold.data.id, "a retried sale does not create a second card");
  const code = sold.data.code;
  const cardLookup = await ok(call("GET", `/api/customers/gift-cards/lookup?code=${encodeURIComponent(code.toLowerCase())}`, { session: cashierS }), 200, "lookup");
  assert.equal(cardLookup.data.balance, 500);
  assert.ok(cardLookup.data.code.startsWith("****-"), "the till sees a masked code");
  await ok(call("GET", `/api/customers/gift-cards/lookup?code=${encodeURIComponent(code)}`, { session: outsiderS }), 404, "cards belong to one business");
  await ok(call("POST", "/api/customers/gift-cards", { session: cashierS, body: { amount: 50, payment_method: "Cash" } }), 400, "below the smallest card");
  await ok(call("POST", "/api/customers/gift-cards", { session: waiterS, body: { amount: 500, payment_method: "Cash" } }), 403, "waiter cannot sell cards");
  await ok(call("POST", "/api/customers/gift-cards", { session: cashierS, body: { amount: 500, payment_method: "UPI" } }), 400, "UPI needs a reference");
  const upiCard = await ok(call("POST", "/api/customers/gift-cards", { session: cashierS, body: { amount: 1000, payment_method: "UPI", payment_reference: "UTR123", outlet_id: outlet.id } }), 201, "UPI sale");
  assert.equal(upiCard.data.status, "pending_payment");
  assert.equal(await failsWith(bill({ payments: [{ method: "Gift Card", gift_card_code: upiCard.data.code, amount: 100 }] })), "GIFT_CARD_NOT_USABLE", "unconfirmed cards cannot pay");
  await ok(call("POST", `/api/customers/gift-cards/${upiCard.data.id}/confirm-payment`, { session: cashierS, body: {} }), 403, "cashier cannot confirm");
  await ok(call("POST", `/api/customers/gift-cards/${upiCard.data.id}/confirm-payment`, { session: managerS, body: { reference: "UTR123" } }), 200, "manager confirms");

  const split = await bill({ payments: [{ method: "Gift Card", gift_card_code: code, amount: 300 }] });
  assert.equal(split.total, 1180, "GST is charged on the food, the card is only a way to pay");
  assert.equal(split.payment_status, "paid", "the rest was taken in cash");
  assert.deepEqual(split.payments.map((row) => [row.method, row.amount, row.status]), [["Gift Card", 300, "confirmed"], ["Cash", 880, "confirmed"]]);
  assert.ok(!JSON.stringify(split.payments).includes(code.replace(/-/g, "")), "the full card code is never stored on the bill");
  assert.equal(Number((await prisma.giftCard.findUnique({ where: { id: sold.data.id } })).balance), 200);
  assert.equal(await failsWith(bill({ payments: [{ method: "Gift Card", gift_card_code: code, amount: 250 }] })), "GIFT_CARD_INSUFFICIENT");
  assert.equal(await failsWith(bill({ payments: [{ method: "Gift Card", gift_card_code: "AAAA-BBBB-CCCC-DDDD", amount: 10 }] })), "GIFT_CARD_NOT_FOUND");
  const racing = await Promise.allSettled([1, 2].map(() => bill({ payments: [{ method: "Gift Card", gift_card_code: code, amount: 150 }] })));
  assert.equal(racing.filter((result) => result.status === "fulfilled").length, 1, "two tills cannot spend the same balance");
  assert.equal(Number((await prisma.giftCard.findUnique({ where: { id: sold.data.id } })).balance), 50);

  // Refund back onto the card; never more than the card paid.
  await billingService.refundInvoice({ ...scope(bizA), invoiceId: split.id, user: actor(manager), payload: { amount: 100, reason: "late", method: "Gift Card" } });
  assert.equal(Number((await prisma.giftCard.findUnique({ where: { id: sold.data.id } })).balance), 150);
  assert.equal(await failsWith(billingService.refundInvoice({ ...scope(bizA), invoiceId: split.id, user: actor(manager), payload: { amount: 300, reason: "x", method: "Gift Card" } })), "GIFT_CARD_REFUND_EXCEEDS");

  // Pay a due bill later with a card; block and unblock; void with a cash payout.
  const dueBill = await bill({ payment_type: "Due" });
  const cardPaid = await billingService.addPayment({ ...scope(bizA), invoiceId: dueBill.id, user: actor(cashier), payload: { amount: 100, method: "Gift Card", gift_card_code: code } });
  assert.equal(cardPaid.payments.at(-1).status, "confirmed");
  await ok(call("POST", `/api/customers/gift-cards/${sold.data.id}/block`, { session: cashierS, body: { reason: "reported lost" } }), 200, "block");
  assert.equal(await failsWith(bill({ payments: [{ method: "Gift Card", gift_card_code: code, amount: 10 }] })), "GIFT_CARD_NOT_USABLE");
  await ok(call("POST", `/api/customers/gift-cards/${sold.data.id}/unblock`, { session: cashierS, body: { reason: "found" } }), 200, "unblock");
  await ok(call("POST", `/api/customers/gift-cards/${sold.data.id}/void`, { session: cashierS, body: { reason: "x" } }), 403, "cashier cannot void");
  await ok(call("POST", `/api/customers/gift-cards/${sold.data.id}/void`, { session: managerS, body: { reason: "customer wants cash", refund_method: "Cash" } }), 200, "void");
  const detail = await ok(call("GET", `/api/customers/gift-cards/${sold.data.id}`, { session: managerS }), 200, "card detail");
  assert.deepEqual(detail.data.transactions.map((row) => row.type).reverse().filter((type) => type !== "adjust"), ["issue", "redeem", "redeem", "refund", "redeem", "void"]);
  const drawer = await billingService.getCashDrawerReport({ ...scope(bizA), outletId: outlet.id });
  assert.equal(drawer.gift_card_sales_cash, 500);
  assert.equal(drawer.gift_card_refunds_cash, 50);
  assert.equal(drawer.gift_card_sales_other, 1000);
  assert.ok(drawer.gift_card_redeemed >= 550, "card payments are not counted as new takings");
  const liability = await ok(call("GET", "/api/customers/gift-cards/summary", { session: managerS }), 200, "summary");
  assert.equal(liability.data.outstanding, 1000);

  // Erasure on request.
  await ok(call("POST", `/api/customers/profiles/${asha.id}/erase`, { session: cashierS, body: { reason: "request" } }), 403, "erasure needs a manager");
  const erased = await ok(call("POST", `/api/customers/profiles/${asha.id}/erase`, { session: managerS, body: { reason: "customer request by email" } }), 200, "erase");
  assert.equal(erased.data.phone, null);
  assert.equal(erased.data.loyalty_points, 0);
  const erasedBill = await prisma.bill.findUnique({ where: { id: redeemed.id } });
  assert.equal(erasedBill.metadata.customer_phone, null);
  assert.equal(Number(erasedBill.total), 1062, "the bill's amounts are kept");
  const fresh = await bill({ customer_phone: "9845012345", customer_name: "Asha" });
  assert.notEqual(fresh.customer_id, asha.id, "a new visit starts a new profile");

  // ================================================================ payroll
  assert.equal(amountInWords(1234567.5), "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees and Fifty Paise Only");
  await ok(call("GET", "/api/payroll/runs", { session: managerS }), 403, "payroll is Owner-only by default");
  await ok(call("PUT", `/api/staff/${manager.id}/permissions`, { session: ownerS, body: { permissions: [...manager.permissions, "payroll"] } }), 200, "grant payroll");
  await ok(call("PUT", `/api/payroll/profiles/${manager.id}`, { session: managerS, body: { pay_type: "monthly", monthly_salary: 99999 } }), 403, "no editing your own pay");
  await ok(call("PUT", `/api/payroll/profiles/${owner.id}`, { session: managerS, body: { pay_type: "monthly", monthly_salary: 1 } }), 403, "no editing the owner's pay");
  await ok(call("PUT", `/api/payroll/profiles/${waiter.id}`, { session: managerS, body: { pay_type: "monthly", monthly_salary: 30000, pf_enabled: true, professional_tax: 200, pan: "abcde1234f", bank_account: "1234 5678 9012", ifsc: "HDFC0001234" } }), 200, "waiter pay");
  await ok(call("PUT", `/api/payroll/profiles/${waiter.id}`, { session: managerS, body: { pan: "BADPAN" } }), 400, "PAN is checked");
  await ok(call("PUT", `/api/payroll/profiles/${chef.id}`, { session: managerS, body: { pay_type: "hourly", hourly_rate: 100, overtime_eligible: true, esi_enabled: true } }), 200, "chef pay");
  await ok(call("PUT", `/api/payroll/profiles/${cashier.id}`, { session: managerS, body: { pay_type: "daily", daily_rate: 800, allowances: [{ name: "Travel", amount: 500 }] } }), 200, "cashier pay");
  const profiles = await ok(call("GET", "/api/payroll/profiles", { session: managerS }), 200, "profiles");
  const waiterProfile = profiles.data.find((row) => row.user_id === waiter.id).profile;
  assert.equal(waiterProfile.pan, "ABCDE1234F");
  assert.equal(waiterProfile.bank_account_last4, "9012", "only the last four account digits are kept");

  // Last month's attendance.
  const now = new Date();
  const monthStartUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const month = new Date(monthStartUtc).toISOString().slice(0, 7);
  const at = (day, hour) => new Date(monthStartUtc + (day - 1) * DAY + hour * 60 * 60 * 1000 - 330 * 60000).toISOString(); // IST
  const shift = (user, day, fromHour, toHour) => call("POST", "/api/attendance/entries", { session: managerS, body: { user_id: user.id, clock_in_at: at(day, fromHour), clock_out_at: at(day, toHour), reason: "payroll test" } });
  await ok(shift(chef, 3, 9, 19), 201, "chef 10 h");
  await ok(shift(chef, 4, 9, 17), 201, "chef 8 h");
  await ok(shift(cashier, 3, 9, 17), 201, "cashier day 1");
  await ok(shift(cashier, 5, 9, 17), 201, "cashier day 2");

  const run = await ok(call("POST", "/api/payroll/runs", { session: managerS, body: { month } }), 201, "create run");
  await ok(call("POST", "/api/payroll/runs", { session: managerS, body: { month } }), 409, "one payroll per month");
  const slipOf = (data, user) => data.payslips.find((slip) => slip.user_id === user.id);
  const chefSlip = slipOf(run.data, chef);
  assert.equal(chefSlip.hours_worked, 18);
  assert.equal(chefSlip.overtime_hours, 1, "one hour past the 9-hour day");
  assert.equal(chefSlip.gross, 1900, "17 h x 100 + 1 h overtime at double");
  assert.equal(chefSlip.deductions.find((row) => row.name.startsWith("ESI")).amount, 15, "0.75% of 1900, rounded up");
  const cashierSlip = slipOf(run.data, cashier);
  assert.equal(cashierSlip.days_present, 2);
  assert.equal(cashierSlip.gross, 2100, "2 days x 800 + travel 500");
  const waiterSlip = slipOf(run.data, waiter);
  assert.equal(waiterSlip.gross, 30000);
  assert.deepEqual(waiterSlip.deductions.map((row) => [row.name, row.amount]), [["PF (12%)", 1800], ["Professional tax", 200]]);
  assert.equal(waiterSlip.employer_contributions[0].amount, 1800);
  assert.equal(waiterSlip.net_pay, 28000);
  assert.equal(waiterSlip.net_pay_words, "Twenty Eight Thousand Rupees Only");
  assert.ok(!slipOf(run.data, manager), "people without a pay profile are left out");

  // Draft adjustments: loss of pay, TDS, bonus.
  const edited = await ok(call("PUT", `/api/payroll/payslips/${waiterSlip.id}`, { session: managerS, body: { lop_days: 3,
    manual_lines: [{ kind: "earning", name: "Festival bonus", amount: 1000 }, { kind: "deduction", name: "TDS", amount: 500 }] } }), 200, "edit payslip");
  const basicLine = edited.data.earnings.find((row) => row.name === "Basic").amount;
  const expectedPf = Math.round(Math.min(basicLine, 15000) * 0.12);
  assert.equal(edited.data.deductions.find((row) => row.name.startsWith("PF")).amount, expectedPf);
  assert.equal(edited.data.net_pay, Math.round(edited.data.gross - edited.data.total_deductions));
  assert.ok(edited.data.gross < 30000 + 1000, "three unpaid days reduce the salary");
  await ok(call("PUT", `/api/payroll/payslips/${waiterSlip.id}`, { session: managerS, body: { lop_days: 99 } }), 400, "LOP within the month");

  // Open shifts block finalising.
  const open = await prisma.attendanceEntry.create({ data: { businessId: bizA, userId: chef.id, userName: chef.name, clockInAt: new Date(at(10, 9)), source: "self" } });
  assert.equal((await call("POST", `/api/payroll/runs/${run.data.id}/finalize`, { session: managerS })).code, "PAYROLL_OPEN_SHIFTS");
  await prisma.attendanceEntry.delete({ where: { id: open.id } });
  const finalized = await ok(call("POST", `/api/payroll/runs/${run.data.id}/finalize`, { session: managerS }), 200, "finalise");
  assert.equal(finalized.data.status, "finalized");
  await ok(call("PUT", `/api/payroll/payslips/${waiterSlip.id}`, { session: managerS, body: { lop_days: 0 } }), 409, "finalised payslips are frozen");
  await ok(call("POST", `/api/attendance/entries`, { session: managerS, body: { user_id: chef.id, clock_in_at: at(6, 9), clock_out_at: at(6, 12), reason: "late entry" } }), 201, "later attendance change");
  const frozen = await ok(call("GET", `/api/payroll/runs/${run.data.id}`, { session: managerS }), 200, "run");
  assert.equal(slipOf(frozen.data, chef).gross, 1900, "attendance changes after finalising do not alter the payslip");

  // Staff see only their own finalised payslips.
  const mine = await ok(call("GET", "/api/payroll/my-payslips", { session: waiterS }), 200, "my payslips");
  assert.equal(mine.data.length, 1);
  assert.equal(mine.data[0].profile.pan, "ABCDE1234F");
  await ok(call("GET", `/api/payroll/payslips/${waiterSlip.id}`, { session: waiterS }), 200, "own payslip");
  await ok(call("GET", `/api/payroll/payslips/${waiterSlip.id}`, { session: chefS }), 404, "someone else's payslip");
  await ok(call("GET", `/api/payroll/payslips/${waiterSlip.id}`, { session: outsiderS }), 404, "another business");
  const paidRun = await ok(call("POST", `/api/payroll/runs/${run.data.id}/pay`, { session: managerS, body: { payslip_ids: [waiterSlip.id], method: "Bank transfer", reference: "NEFT42" } }), 200, "mark paid");
  assert.equal(slipOf(paidRun.data, waiter).payment_reference, "NEFT42");
  await ok(call("POST", `/api/payroll/runs/${run.data.id}/pay`, { session: managerS, body: { payslip_ids: [waiterSlip.id] } }), 409, "already paid");
  await ok(call("POST", `/api/payroll/runs/${run.data.id}/void`, { session: managerS, body: { reason: "x" } }), 403, "only the owner voids payroll");
  await ok(call("POST", `/api/payroll/runs/${run.data.id}/void`, { session: ownerS, body: { reason: "wrong salary" } }), 200, "void");
  await ok(call("POST", "/api/payroll/runs", { session: managerS, body: { month } }), 201, "a voided month can be run again");
  assert.equal((await call("GET", "/api/payroll/my-payslips", { session: waiterS })).data.length, 0, "voided and draft payslips are not shown to staff");

  // Pure calculation check: monthly with ESI above the wage limit charges no ESI.
  const high = calculatePayslip({ snapshot: { pay_type: "monthly", monthly_salary: 40000, basic_percent: 50, allowances: [], deductions: [], pf_enabled: true, esi_enabled: true, professional_tax: 0, overtime_eligible: false },
    entries: [], settings: DEFAULT_PAYROLL_SETTINGS, period: { days: 30 } });
  assert.ok(!high.deductions.some((row) => row.name.startsWith("ESI")), "ESI only below the wage limit");
  assert.equal(high.deductions[0].amount, 1800, "PF on the 15000 ceiling");

  console.log("Customers, loyalty, gift cards and payroll passed: profiles, earning/redeeming/expiry/reversal, erasure, card sale/confirm/redeem/refund/void/race, drawer, payslips with PF/ESI/PT/OT/LOP, finalise/pay/void, staff access");
} finally {
  await prisma.business.deleteMany({ where: { id: { in: [bizA, bizB] } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: suffix } } }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await stopRealtime();
  await prisma.$disconnect();
}
