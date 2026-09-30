import prisma from "../../database/prisma/client.js";
import { readState, writeState } from "../../database/prisma/state-store.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { STAFF_ROLE_OPTIONS } from "../../shared/constants/access.constants.js";
import { publishChange } from "../../services/realtime/realtime.service.js";
import { parseRange, workedMs } from "./attendance.service.js";

/**
 * Tips.
 *
 * A tip is money for staff, not revenue: it is never taxed and never discounted. It is recorded on a bill (the
 * customer pays it with the bill), comes from a QR order, or is declared (cash handed straight to someone).
 *
 * A tip goes to one person or into the pool. The pool of a period is shared by hours worked (from attendance) among
 * the roles the business chooses. A bill tip only counts once the bill is fully paid, and not if the bill is voided
 * or fully refunded. Payouts are checked against the recomputed balance, so the same money cannot be paid twice.
 */
const MAX_DECLARED_TIP = 100000;
const DEFAULT_SETTINGS = { tip_pool_roles: ["Waiter", "Chef", "Cashier"] };

const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
const toPaise = (value) => Math.round(Number(value || 0) * 100);
const fromPaise = (value) => Math.round(value) / 100;
const settingsKey = (businessId) => `staff-settings:${businessId}`;

const parseAmount = (value, { max, field = "Tip amount" } = {}) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) fail(400, "TIP_AMOUNT_INVALID", `${field} must be a positive number`);
  if (max !== undefined && amount > max) fail(400, "TIP_AMOUNT_INVALID", `${field} is too large`);
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) fail(400, "TIP_AMOUNT_INVALID", `${field} can have at most 2 decimals`);
  return Math.round(amount * 100) / 100;
};

/** Validates who a tip is for. Returns null for the pool. */
export const resolveTipRecipient = async (client, businessId, userId) => {
  if (userId === undefined || userId === null || userId === "") return null;
  const user = await client.user.findFirst({ where: { id: String(userId), businessId }, select: { id: true, name: true, active: true } });
  if (!user || !user.active) fail(400, "TIP_RECIPIENT_INVALID", "The tip recipient is not an active staff member of this business");
  return user;
};

/** Called inside the bill transaction. */
export const recordBillTip = async (tx, { businessId, billId, outletId, amount, recipient, source, actor }) => {
  if (!(Number(amount) > 0)) return null;
  const tip = await tx.tip.create({ data: {
    businessId, billId, outletId: outletId || null, amount, source,
    pooled: !recipient, userId: recipient?.id || null, recipientName: recipient?.name || null,
    createdById: actor?.id || null, createdByName: actor?.name || null,
  } });
  await publishChange({ businessId, resource: "tips", action: "created", recordId: tip.id, outletId }, { tx });
  return tip;
};

/** Whether a tip counts yet: bill tips wait for full payment and drop out when the bill is voided or refunded. */
const tipState = (tip) => {
  if (tip.voidedAt) return "void";
  if (!tip.bill) return "counted";
  if (["void", "refunded"].includes(tip.bill.status)) return "cancelled";
  return tip.bill.metadata?.payment_status === "paid" ? "counted" : "pending";
};

const serializeTip = (tip) => ({
  id: tip.id,
  bill_id: tip.billId,
  invoice_number: tip.bill?.invoiceNumber || null,
  outlet_id: tip.outletId,
  pooled: tip.pooled,
  user_id: tip.userId,
  recipient_name: tip.pooled ? null : tip.recipientName,
  amount: Number(tip.amount),
  source: tip.source,
  method: tip.method,
  note: tip.note,
  state: tipState(tip),
  created_by_name: tip.createdByName,
  created_at: tip.createdAt.toISOString(),
  void_reason: tip.voidReason,
});

const serializePayout = (payout) => ({
  id: payout.id,
  user_id: payout.userId,
  user_name: payout.userName,
  amount: Number(payout.amount),
  period_from: payout.periodFrom.toISOString(),
  period_to: payout.periodTo.toISOString(),
  method: payout.method,
  note: payout.note,
  paid_by_name: payout.paidByName,
  created_at: payout.createdAt.toISOString(),
  voided: Boolean(payout.voidedAt),
  void_reason: payout.voidReason,
});

/** Splits `paise` by weight, exactly (largest remainder), so shares always add up to the pool. */
export const allocate = (paise, weights) => {
  const total = weights.reduce((sum, row) => sum + row.weight, 0);
  if (!total || paise <= 0) return new Map();
  const rows = weights.map((row) => {
    const exact = (paise * row.weight) / total;
    return { key: row.key, share: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = paise - rows.reduce((sum, row) => sum + row.share, 0);
  [...rows].sort((a, b) => b.remainder - a.remainder || String(a.key).localeCompare(String(b.key))).forEach((row) => {
    if (left > 0) { row.share += 1; left -= 1; }
  });
  return new Map(rows.map((row) => [row.key, row.share]));
};

class TipsService {
  async getSettings({ businessId }) {
    const stored = await readState(settingsKey(businessId), null);
    return { ...DEFAULT_SETTINGS, ...(stored || {}) };
  }

  async updateSettings({ businessId, payload = {} }) {
    const roles = payload.tip_pool_roles;
    if (!Array.isArray(roles) || roles.some((role) => !STAFF_ROLE_OPTIONS.includes(role))) {
      fail(400, "TIP_SETTINGS_INVALID", `tip_pool_roles must be a list of: ${STAFF_ROLE_OPTIONS.join(", ")}`);
    }
    const next = { ...(await this.getSettings({ businessId })), tip_pool_roles: [...new Set(roles)] };
    await writeState(settingsKey(businessId), next);
    return next;
  }

  /** Cash a customer handed over directly. Staff declare their own; the tips screen can declare for anyone or the pool. */
  async declare({ businessId, actor, canManage, payload = {} }) {
    const amount = parseAmount(payload.amount, { max: MAX_DECLARED_TIP });
    const pooled = payload.pooled === true;
    const forUserId = pooled ? null : String(payload.user_id || actor.id);
    if ((pooled || forUserId !== actor.id) && !canManage) fail(403, "TIPS_FORBIDDEN", "You can only declare your own tips");
    const recipient = pooled ? null : await resolveTipRecipient(prisma, businessId, forUserId);
    if (payload.outlet_id && !await prisma.outlet.findFirst({ where: { id: String(payload.outlet_id), businessId }, select: { id: true } })) {
      fail(404, "OUTLET_NOT_FOUND", "Outlet not found for this business");
    }
    const tip = await prisma.tip.create({ data: {
      businessId, outletId: payload.outlet_id ? String(payload.outlet_id) : null, amount, source: "declared",
      method: String(payload.method || "Cash").slice(0, 30), note: payload.note ? String(payload.note).slice(0, 300) : null,
      pooled, userId: recipient?.id || null, recipientName: recipient?.name || null,
      createdById: actor.id, createdByName: actor.name || null,
    }, include: { bill: true } });
    await publishChange({ businessId, resource: "tips", action: "created", recordId: tip.id, outletId: tip.outletId });
    return serializeTip(tip);
  }

  async findTip({ businessId, tipId, outletScope }) {
    const tip = await prisma.tip.findFirst({ where: { id: String(tipId), businessId }, include: { bill: true } });
    if (!tip) fail(404, "TIP_NOT_FOUND", "Tip not found");
    if (outletScope && !(tip.outletId && outletScope.includes(tip.outletId))) fail(403, "OUTLET_ACCESS_DENIED", "You do not have access to this outlet");
    if (tip.voidedAt) fail(409, "TIP_VOIDED", "This tip has been voided");
    return tip;
  }

  async reassign({ businessId, outletScope, tipId, payload = {} }) {
    const tip = await this.findTip({ businessId, tipId, outletScope });
    const recipient = payload.pooled === true ? null : await resolveTipRecipient(prisma, businessId, payload.user_id);
    if (!recipient && payload.pooled !== true) fail(400, "TIP_RECIPIENT_INVALID", "Choose a staff member or the pool");
    const updated = await prisma.tip.update({ where: { id: tip.id }, include: { bill: true }, data: {
      pooled: !recipient, userId: recipient?.id || null, recipientName: recipient?.name || null,
    } });
    await publishChange({ businessId, resource: "tips", action: "updated", recordId: tip.id, outletId: tip.outletId });
    return serializeTip(updated);
  }

  async voidTip({ businessId, actor, outletScope, tipId, payload = {} }) {
    const reason = String(payload.reason || "").trim();
    if (!reason) fail(400, "REASON_REQUIRED", "Give a reason for voiding the tip");
    const tip = await this.findTip({ businessId, tipId, outletScope });
    const updated = await prisma.tip.update({ where: { id: tip.id }, include: { bill: true }, data: {
      voidedAt: new Date(), voidedById: actor.id, voidReason: reason.slice(0, 300),
    } });
    await publishChange({ businessId, resource: "tips", action: "voided", recordId: tip.id, outletId: tip.outletId });
    return serializeTip(updated);
  }

  /**
   * Who earned what in a period. Pass `outletId` to look at one outlet; payouts and balances are only meaningful
   * business-wide, so they are reported only when no outlet is chosen.
   */
  async summary({ businessId, from, to, outletId = null, client = prisma }) {
    const range = parseRange(from, to);
    const settings = await this.getSettings({ businessId });
    const poolRoles = new Set(settings.tip_pool_roles);
    const [tips, entries, payouts, users] = await Promise.all([
      client.tip.findMany({
        where: { businessId, createdAt: { gte: range.from, lt: range.to }, ...(outletId ? { outletId } : {}) },
        include: { bill: { select: { status: true, metadata: true, invoiceNumber: true } } },
        orderBy: { createdAt: "desc" },
      }),
      client.attendanceEntry.findMany({ where: { businessId, deletedAt: null, clockInAt: { gte: range.from, lt: range.to } } }),
      outletId ? [] : client.tipPayout.findMany({ where: { businessId, voidedAt: null, periodFrom: { lt: range.to }, periodTo: { gt: range.from } } }),
      client.user.findMany({ where: { businessId }, include: { role: true } }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const rows = new Map();
    const row = (key, seed) => {
      if (!rows.has(key)) {
        rows.set(key, { user_id: seed.userId || null, name: seed.name, role: seed.role || null, hours_minutes: 0,
          direct: 0, declared: 0, pool_share: 0, pending: 0, paid: 0, partially_paid_overlap: false });
      }
      return rows.get(key);
    };
    const personKey = (userId, name) => userId || `name:${name}`;
    const seedFor = (userId, name) => {
      const user = userId ? userById.get(userId) : null;
      return { userId, name: user?.name || name || "Former staff", role: user?.role?.name || null };
    };

    // Hours worked by pool members, per outlet.
    const hoursByBucket = new Map();
    const now = Date.now();
    for (const entry of entries) {
      const key = personKey(entry.userId, entry.userName);
      const minutesWorked = Math.round(workedMs(entry, now) / 60000);
      const target = row(key, seedFor(entry.userId, entry.userName));
      if (!outletId || entry.outletId === outletId) target.hours_minutes += minutesWorked;
      const role = entry.userRole || userById.get(entry.userId)?.role?.name;
      if (!poolRoles.has(role) || !minutesWorked) continue;
      const bucket = entry.outletId || "none";
      const weights = hoursByBucket.get(bucket) || new Map();
      weights.set(key, (weights.get(key) || 0) + minutesWorked);
      hoursByBucket.set(bucket, weights);
    }

    const poolByBucket = new Map();
    const totals = { direct: 0, declared: 0, pooled: 0, pending: 0, cancelled: 0, voided: 0, undistributed: 0, paid: 0 };
    for (const tip of tips) {
      const state = tipState(tip);
      const paise = toPaise(tip.amount);
      if (state === "void") { totals.voided += paise; continue; }
      if (state === "cancelled") { totals.cancelled += paise; continue; }
      if (state === "pending") {
        totals.pending += paise;
        if (!tip.pooled) row(personKey(tip.userId, tip.recipientName), seedFor(tip.userId, tip.recipientName)).pending += paise;
        continue;
      }
      if (tip.pooled) {
        totals.pooled += paise;
        const bucket = tip.outletId || "none";
        poolByBucket.set(bucket, (poolByBucket.get(bucket) || 0) + paise);
        continue;
      }
      const target = row(personKey(tip.userId, tip.recipientName), seedFor(tip.userId, tip.recipientName));
      if (tip.source === "declared") { target.declared += paise; totals.declared += paise; }
      else { target.direct += paise; totals.direct += paise; }
    }

    // Each outlet's pool goes to those who worked there; if nobody clocked in there, to everyone in the pool.
    const allWeights = new Map();
    for (const weights of hoursByBucket.values()) for (const [key, value] of weights) allWeights.set(key, (allWeights.get(key) || 0) + value);
    for (const [bucket, paise] of poolByBucket) {
      const weights = hoursByBucket.get(bucket)?.size ? hoursByBucket.get(bucket) : allWeights;
      const shares = allocate(paise, [...weights].map(([key, weight]) => ({ key, weight })));
      if (!shares.size) { totals.undistributed += paise; continue; }
      for (const [key, share] of shares) rows.get(key).pool_share += share;
    }

    for (const payout of payouts) {
      const key = personKey(payout.userId, payout.userName);
      const target = row(key, seedFor(payout.userId, payout.userName));
      if (payout.periodFrom >= range.from && payout.periodTo <= range.to) {
        target.paid += toPaise(payout.amount);
        totals.paid += toPaise(payout.amount);
      } else {
        target.partially_paid_overlap = true;
      }
    }

    const staff = [...rows.values()].map((entry) => {
      const earned = entry.direct + entry.declared + entry.pool_share;
      return {
        ...entry,
        hours: Math.round((entry.hours_minutes / 60) * 100) / 100,
        direct: fromPaise(entry.direct),
        declared: fromPaise(entry.declared),
        pool_share: fromPaise(entry.pool_share),
        pending: fromPaise(entry.pending),
        earned: fromPaise(earned),
        paid: outletId ? null : fromPaise(entry.paid),
        balance: outletId ? null : fromPaise(earned - entry.paid),
      };
    }).filter((entry) => entry.earned || entry.pending || entry.paid || entry.hours)
      .sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name));

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      outlet_id: outletId,
      pool_roles: settings.tip_pool_roles,
      totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, fromPaise(value)])),
      staff,
      tips: tips.slice(0, 500).map(serializeTip),
      payouts: payouts.map(serializePayout),
    };
  }

  async me({ businessId, user, from, to }) {
    const summary = await this.summary({ businessId, from, to });
    const mine = summary.staff.find((entry) => entry.user_id === user.id) || {
      user_id: user.id, name: user.name, hours: 0, direct: 0, declared: 0, pool_share: 0, pending: 0, earned: 0, paid: 0, balance: 0,
    };
    return {
      from: summary.from,
      to: summary.to,
      ...mine,
      tips: summary.tips.filter((tip) => !tip.pooled && tip.user_id === user.id),
      payouts: summary.payouts.filter((payout) => payout.user_id === user.id),
    };
  }

  /**
   * Hand tips to someone for a period. Periods of one person may not partly overlap (the same period may be paid in
   * parts), and the amount may not exceed what that period still owes, recomputed under a lock.
   */
  async payout({ businessId, actor, payload = {} }) {
    const range = parseRange(payload.from, payload.to);
    const amount = parseAmount(payload.amount, { field: "Payout amount", max: 10000000 });
    const method = String(payload.method || "Cash").trim().slice(0, 30) || "Cash";
    const requestId = String(payload.client_request_id || "").trim().slice(0, 80) || null;
    const staff = await prisma.user.findFirst({ where: { id: String(payload.user_id || ""), businessId }, select: { id: true, name: true } });
    if (!staff) fail(404, "STAFF_NOT_FOUND", "Staff member not found");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tips:${businessId}`}))`;
      if (requestId) {
        const earlier = await tx.tipPayout.findFirst({ where: { businessId, clientRequestId: requestId } });
        if (earlier) return serializePayout(earlier);
      }
      const overlapping = await tx.tipPayout.findFirst({ where: {
        businessId, userId: staff.id, voidedAt: null, periodFrom: { lt: range.to }, periodTo: { gt: range.from },
        NOT: { periodFrom: range.from, periodTo: range.to },
      } });
      if (overlapping) fail(409, "PAYOUT_PERIOD_OVERLAP", "Tips for part of this period were already paid in another payout. Use the same period or one that does not overlap.");
      const summary = await this.summary({ businessId, from: range.from, to: range.to, client: tx });
      const balance = summary.staff.find((entry) => entry.user_id === staff.id)?.balance || 0;
      if (toPaise(amount) > toPaise(balance)) fail(409, "PAYOUT_EXCEEDS_BALANCE", `Only ${balance.toFixed(2)} is owed for this period`);
      const payout = await tx.tipPayout.create({ data: {
        businessId, userId: staff.id, userName: staff.name, amount, periodFrom: range.from, periodTo: range.to, method,
        note: payload.note ? String(payload.note).slice(0, 300) : null, paidById: actor.id, paidByName: actor.name || null,
        clientRequestId: requestId,
      } });
      await publishChange({ businessId, resource: "tips", action: "paid", recordId: payout.id }, { tx });
      return serializePayout(payout);
    });
  }

  async voidPayout({ businessId, actor, payoutId, payload = {} }) {
    const reason = String(payload.reason || "").trim();
    if (!reason) fail(400, "REASON_REQUIRED", "Give a reason for voiding the payout");
    const payout = await prisma.tipPayout.findFirst({ where: { id: String(payoutId), businessId } });
    if (!payout) fail(404, "PAYOUT_NOT_FOUND", "Payout not found");
    if (payout.voidedAt) fail(409, "PAYOUT_VOIDED", "This payout is already voided");
    const updated = await prisma.tipPayout.update({ where: { id: payout.id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason.slice(0, 300) } });
    await publishChange({ businessId, resource: "tips", action: "payout_voided", recordId: payout.id });
    return serializePayout(updated);
  }
}

export const tipsService = new TipsService();
