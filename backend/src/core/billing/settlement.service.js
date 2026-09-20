import { randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { readState, writeState } from "../../database/prisma/state-store.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { roundMoney } from "./billing-depth.utils.js";

const keyFor = (businessId, outletId) => `shift:${businessId}:${outletId || "all"}`;
const fail = (statusCode, message) => { throw createHttpError({ statusCode, message }); };
const cashAmount = (value) => {
  if ((typeof value === "string" && !value.trim()) || value == null || !["number", "string"].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0) fail(400, "Enter a valid non-negative cash amount");
  return roundMoney(value);
};
export const lockSettlement = (tx, businessId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement:${businessId}`}))`;
const verifyOutlet = async (tx, businessId, outletId) => {
  if (outletId && !await tx.outlet.findFirst({ where: { id: outletId, businessId }, select: { id: true } })) fail(404, "Outlet not found for this business");
};

// Caller holds the settlement lock for the full financial transaction.
export const ensureOpenShift = async (tx, businessId, outletId = null, user = null, openingCash = 0) => {
  await verifyOutlet(tx, businessId, outletId);
  const key = keyFor(businessId, outletId);
  const current = await readState(key, null, tx);
  if (current?.status === "open") return current;
  const shift = { id: `shift_${businessId}_${randomUUID()}`, business_id: businessId, outlet_id: outletId,
    status: "open", opened_at: new Date().toISOString(), opened_by: user?.id || null,
    opened_by_name: user?.name || null, opening_cash: openingCash, closed_at: null };
  await writeState(key, shift, tx);
  return shift;
};

const summarize = async (tx, businessId, shift) => {
  const bills = await tx.bill.findMany({ where: { businessId }, select: { id: true, metadata: true } });
  let cash = 0, nonCash = 0, refunds = 0, cashRefunds = 0, pending = 0;
  const included = new Set();
  for (const bill of bills) {
    const metadata = bill.metadata || {};
    for (const payment of metadata.payments || []) {
      if ((payment.settlement_shift_id || metadata.shift_id) !== shift.id) continue;
      included.add(bill.id);
      if (payment.status === "confirmed") {
        if (String(payment.method).trim().toLowerCase() === "cash") cash += Number(payment.amount || 0);
        else nonCash += Number(payment.amount || 0);
      } else if (!["failed", "cancelled"].includes(payment.status)) pending += Number(payment.amount || 0);
    }
    for (const refund of metadata.refunds || []) {
      if ((refund.settlement_shift_id || metadata.shift_id) !== shift.id) continue;
      included.add(bill.id);
      refunds += Number(refund.amount || 0);
      if (String(refund.method).trim().toLowerCase() === "cash") cashRefunds += Number(refund.amount || 0);
    }
  }
  return { business_id: businessId, outlet_id: shift.outlet_id, shift_id: shift.id,
    opening_cash: shift.opening_cash || 0, cash_sales: roundMoney(cash), non_cash_sales: roundMoney(nonCash),
    refunds: roundMoney(refunds), cash_refunds: roundMoney(cashRefunds), pending_payment_amount: roundMoney(pending),
    expected_cash: roundMoney(Number(shift.opening_cash || 0) + cash - cashRefunds), bill_count: included.size,
    generated_at: new Date().toISOString() };
};

export const settlementService = {
  async current({ businessId, outletId = null }) {
    await verifyOutlet(prisma, businessId, outletId);
    return readState(keyFor(businessId, outletId));
  },
  async open({ businessId, outletId = null, openingCash = 0, user }) {
    const amount = cashAmount(openingCash);
    return prisma.$transaction(async (tx) => {
      await lockSettlement(tx, businessId);
      const current = await readState(keyFor(businessId, outletId), null, tx);
      if (current?.status === "open" && Number(current.opening_cash || 0) !== amount) fail(409, "A shift is already open with a different opening balance");
      return ensureOpenShift(tx, businessId, outletId, user, amount);
    });
  },
  async report({ businessId, outletId = null, shiftId = null }) {
    await verifyOutlet(prisma, businessId, outletId);
    const current = await readState(keyFor(businessId, outletId));
    const shift = shiftId && current?.id !== shiftId ? await readState(`shift-history:${shiftId}`) : current;
    if (!shift || shift.business_id !== businessId || (shift.outlet_id || null) !== outletId) fail(404, "Shift not found");
    return shift.status === "closed" && shift.report ? shift.report : summarize(prisma, businessId, shift);
  },
  async close({ businessId, outletId = null, closingCash, shiftId, user }) {
    const amount = cashAmount(closingCash);
    if (!shiftId) fail(400, "The shift being closed is required");
    return prisma.$transaction(async (tx) => {
      await lockSettlement(tx, businessId);
      await verifyOutlet(tx, businessId, outletId);
      const key = keyFor(businessId, outletId);
      const shift = await readState(key, null, tx);
      if (!shift || shift.id !== shiftId) fail(409, "The shift has changed. Refresh before closing");
      if (shift.status === "closed") {
        if (shift.closing_cash !== amount) fail(409, "A closed settlement cannot be changed");
        return shift;
      }
      if (shift.opened_by && shift.opened_by !== user?.id && !["Owner", "Manager"].includes(user?.role)) fail(403, "Only the opening cashier or a manager can close this shift");
      const report = await summarize(tx, businessId, shift);
      const closed = { ...shift, status: "closed", closed_at: new Date().toISOString(), closed_by: user?.id,
        closed_by_name: user?.name || null, closing_cash: amount, expected_cash: report.expected_cash,
        variance: roundMoney(amount - report.expected_cash), report };
      await writeState(`shift-history:${shift.id}`, closed, tx);
      await writeState(key, closed, tx);
      return closed;
    });
  },
  async history({ businessId, outletId = null }) {
    await verifyOutlet(prisma, businessId, outletId);
    const rows = await prisma.stateDocument.findMany({
      where: { key: { startsWith: "shift-history:" }, AND: [
        { data: { path: ["business_id"], equals: businessId } },
        ...(outletId ? [{ data: { path: ["outlet_id"], equals: outletId } }] : []),
      ] }, orderBy: { updatedAt: "desc" }, take: 100,
    });
    return rows.map((row) => row.data);
  },
};
