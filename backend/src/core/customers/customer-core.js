import prisma from "../../database/prisma/client.js";
import { readState, writeState } from "../../database/prisma/state-store.js";
import { createHttpError } from "../../shared/utils/http-error.js";

/**
 * Customers and loyalty, as used inside billing transactions.
 *
 * Points ledger: every change is a LoyaltyEntry and the customer's balance is the running sum. Earned points expire
 * after the configured months; spending uses the points that expire soonest first. A bill's loyalty effect is
 * *reconciled* after every change to the bill (created, paid, refunded, voided): the ledger is brought to what the
 * bill should have earned and redeemed right now, so repeated calls never double-count.
 */
const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

export const DEFAULT_CUSTOMER_SETTINGS = {
  loyalty: {
    enabled: true,
    earn_percent: 5,
    point_value: 1,
    min_bill_amount: 0,
    min_redeem_points: 100,
    max_redeem_percent: 50,
    expiry_months: 12,
  },
  gift_cards: {
    expiry_months: 12,
    min_value: 100,
    max_value: 50000,
  },
};

const settingsKey = (businessId) => `customer-settings:${businessId}`;

export const getCustomerSettings = async (businessId, client = prisma) => {
  const stored = (await readState(settingsKey(businessId), null, client)) || {};
  return {
    loyalty: { ...DEFAULT_CUSTOMER_SETTINGS.loyalty, ...(stored.loyalty || {}) },
    gift_cards: { ...DEFAULT_CUSTOMER_SETTINGS.gift_cards, ...(stored.gift_cards || {}) },
  };
};

const numberIn = (value, min, max, field, { integer = false } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    fail(400, "SETTINGS_INVALID", `${field} must be ${integer ? "a whole number " : ""}between ${min} and ${max}`);
  }
  return number;
};

export const saveCustomerSettings = async (businessId, payload = {}) => {
  const current = await getCustomerSettings(businessId);
  const loyalty = { ...current.loyalty, ...(payload.loyalty || {}) };
  const giftCards = { ...current.gift_cards, ...(payload.gift_cards || {}) };
  const next = {
    loyalty: {
      enabled: Boolean(loyalty.enabled),
      earn_percent: numberIn(loyalty.earn_percent, 0, 50, "Earn percent"),
      point_value: numberIn(loyalty.point_value, 0.01, 100, "Point value"),
      min_bill_amount: numberIn(loyalty.min_bill_amount, 0, 1000000, "Minimum bill"),
      min_redeem_points: numberIn(loyalty.min_redeem_points, 1, 1000000, "Minimum points to redeem", { integer: true }),
      max_redeem_percent: numberIn(loyalty.max_redeem_percent, 1, 100, "Maximum share of a bill paid with points"),
      expiry_months: numberIn(loyalty.expiry_months, 0, 120, "Points expiry months", { integer: true }),
    },
    gift_cards: {
      expiry_months: numberIn(giftCards.expiry_months, 0, 120, "Gift card validity months", { integer: true }),
      min_value: numberIn(giftCards.min_value, 1, 1000000, "Smallest gift card"),
      max_value: numberIn(giftCards.max_value, 1, 10000000, "Largest gift card"),
    },
  };
  if (next.gift_cards.max_value < next.gift_cards.min_value) fail(400, "SETTINGS_INVALID", "Largest gift card must be at least the smallest");
  await writeState(settingsKey(businessId), next);
  return next;
};

/** Digits of the national number: +91 98450 12345, 098450 12345 and 9845012345 are the same person. */
export const normalizePhone = (value) => {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
};

const isPlaceholderName = (name) => !name || ["walk-in", "walk-in customer", "guest"].includes(String(name).trim().toLowerCase());

export const addMonths = (date, months) => {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
};

const lockCustomer = (tx, customerId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer:${customerId}`}))`;

/** Finds or creates the customer behind a phone number on a bill. Returns null for bills without a usable phone. */
export const upsertCustomerForBill = async (tx, { businessId, phone, name, marketingOptIn = false }) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${businessId}:${normalized}`}))`;
  const existing = await tx.customer.findUnique({ where: { businessId_phone: { businessId, phone: normalized } } });
  const cleanName = isPlaceholderName(name) ? null : String(name).trim().slice(0, 120);
  // Consent is only ever given here (ticked at the till with the guest's agreement), never withdrawn.
  const consent = marketingOptIn === true ? { marketingOptIn: true, marketingConsentAt: new Date(), marketingOptOutAt: null } : {};
  if (existing) {
    const data = {
      ...(cleanName && isPlaceholderName(existing.name) ? { name: cleanName } : {}),
      ...(consent.marketingOptIn && !existing.marketingOptIn ? consent : {}),
    };
    return Object.keys(data).length ? tx.customer.update({ where: { id: existing.id }, data }) : existing;
  }
  return tx.customer.create({ data: { businessId, phone: normalized, name: cleanName || "Guest", ...consent } });
};

const writeEntry = async (tx, customer, { type, points, value = null, billId = null, expiresAt = null, note = null, actor = null }) => {
  const updated = await tx.customer.update({ where: { id: customer.id }, data: { loyaltyPoints: { increment: points } } });
  await tx.loyaltyEntry.create({ data: {
    businessId: customer.businessId, customerId: customer.id, billId, type, points, value, balanceAfter: updated.loyaltyPoints,
    expiresAt, note: note ? String(note).slice(0, 300) : null, createdById: actor?.id || null, createdByName: actor?.name || null,
  } });
  return updated;
};

/**
 * Expires points whose time is up. Spent points are taken from the lots that expire soonest, so only genuinely unused
 * points expire. Call with the customer locked.
 */
export const expireDuePoints = async (tx, customerId, now = new Date()) => {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.loyaltyPoints <= 0) return customer;
  const entries = await tx.loyaltyEntry.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
  const lots = entries.filter((entry) => entry.points > 0)
    .map((entry) => ({ expiresAt: entry.expiresAt, remaining: entry.points, createdAt: entry.createdAt }))
    .sort((a, b) => (a.expiresAt ? a.expiresAt.getTime() : Infinity) - (b.expiresAt ? b.expiresAt.getTime() : Infinity) || a.createdAt - b.createdAt);
  let used = entries.filter((entry) => entry.points < 0).reduce((sum, entry) => sum - entry.points, 0);
  for (const lot of lots) {
    const take = Math.min(lot.remaining, used);
    lot.remaining -= take;
    used -= take;
  }
  const due = Math.min(customer.loyaltyPoints, lots.filter((lot) => lot.expiresAt && lot.expiresAt <= now).reduce((sum, lot) => sum + lot.remaining, 0));
  if (due <= 0) return customer;
  return writeEntry(tx, customer, { type: "expire", points: -due, note: "Points expired" });
};

/** Current balance after expiry, with the customer locked for the rest of the transaction. */
export const lockedBalance = async (tx, customerId) => {
  await lockCustomer(tx, customerId);
  return expireDuePoints(tx, customerId);
};

/** Points a bill may redeem, checked before the bill is written. Returns the discount value. */
export const validateRedemption = async (tx, { businessId, customer, points, eligibleAmount }) => {
  if (!points) return 0;
  const { loyalty } = await getCustomerSettings(businessId, tx);
  if (!loyalty.enabled) fail(400, "LOYALTY_DISABLED", "The loyalty programme is switched off");
  if (!customer) fail(400, "LOYALTY_CUSTOMER_REQUIRED", "Enter the customer's phone number to use points");
  if (!Number.isInteger(points) || points < 0) fail(400, "LOYALTY_POINTS_INVALID", "Points must be a whole number");
  if (points < loyalty.min_redeem_points) fail(400, "LOYALTY_BELOW_MINIMUM", `At least ${loyalty.min_redeem_points} points are needed to redeem`);
  const value = roundMoney(points * loyalty.point_value);
  const cap = roundMoney(eligibleAmount * (loyalty.max_redeem_percent / 100));
  if (value > cap) fail(400, "LOYALTY_ABOVE_LIMIT", `Points can pay at most ${loyalty.max_redeem_percent}% of this bill (${cap.toFixed(2)})`);
  const current = await lockedBalance(tx, customer.id);
  if (current.loyaltyPoints < points) fail(400, "LOYALTY_INSUFFICIENT", `${current.name} has only ${current.loyaltyPoints} points`);
  return value;
};

const sumPoints = (entries, types) => entries.filter((entry) => types.includes(entry.type)).reduce((sum, entry) => sum + entry.points, 0);

/**
 * Brings a bill's loyalty ledger and the customer's visit/spend figures in line with the bill as it is now.
 * Earning waits for full payment; voiding or fully refunding returns redeemed points and takes earned points back;
 * a partial refund takes back the matching share of earned points. Returns the metadata fields to store on the bill.
 */
export const reconcileBillCustomer = async (tx, { bill, actor = null }) => {
  const metadata = bill.metadata || {};
  const customerId = metadata.customer_id;
  if (!customerId) return {};
  await lockCustomer(tx, customerId);
  const customer = await expireDuePoints(tx, customerId);
  if (!customer || customer.businessId !== bill.businessId) return {};
  const { loyalty } = await getCustomerSettings(bill.businessId, tx);
  const total = Number(bill.total || 0);
  const refunded = Number(metadata.refunded_amount || 0);
  const reversed = bill.status === "void" || bill.status === "refunded";
  const keptShare = total > 0 ? Math.max(0, 1 - refunded / total) : 0;

  // --- visit and spend
  const counted = metadata.customer_stats || { visit: 0, spent: 0 };
  const desiredStats = { visit: bill.status === "void" ? 0 : 1, spent: bill.status === "void" ? 0 : roundMoney(Math.max(0, total - refunded)) };
  if (desiredStats.visit !== counted.visit || desiredStats.spent !== counted.spent) {
    const visitedAt = bill.createdAt || new Date();
    await tx.customer.update({ where: { id: customer.id }, data: {
      visitCount: { increment: desiredStats.visit - counted.visit },
      totalSpent: { increment: roundMoney(desiredStats.spent - counted.spent) },
      ...(desiredStats.visit && !counted.visit ? {
        lastVisitAt: !customer.lastVisitAt || customer.lastVisitAt < visitedAt ? visitedAt : customer.lastVisitAt,
        firstVisitAt: !customer.firstVisitAt || customer.firstVisitAt > visitedAt ? visitedAt : customer.firstVisitAt,
      } : {}),
    } });
  }

  const entries = await tx.loyaltyEntry.findMany({ where: { billId: bill.id, customerId: customer.id } });
  let current = await tx.customer.findUnique({ where: { id: customer.id } });

  // --- redeemed points: held while the bill stands, returned when it is voided or fully refunded
  const redeemPoints = Number(metadata.loyalty_redeem_points || 0);
  const redeemNet = sumPoints(entries, ["redeem", "reverse_redeem"]);
  const redeemDelta = (reversed ? 0 : -redeemPoints) - redeemNet;
  if (redeemDelta < 0) {
    if (current.loyaltyPoints < -redeemDelta) fail(400, "LOYALTY_INSUFFICIENT", `${current.name} has only ${current.loyaltyPoints} points`);
    current = await writeEntry(tx, current, { type: "redeem", points: redeemDelta, value: roundMoney(-redeemDelta * loyalty.point_value), billId: bill.id, actor,
      note: `Paid part of bill ${bill.invoiceNumber || bill.id}` });
  } else if (redeemDelta > 0) {
    current = await writeEntry(tx, current, { type: "reverse_redeem", points: redeemDelta, billId: bill.id, actor,
      expiresAt: loyalty.expiry_months ? addMonths(new Date(), loyalty.expiry_months) : null,
      note: `Returned: bill ${bill.invoiceNumber || bill.id} ${bill.status === "void" ? "voided" : "refunded"}` });
  }

  // --- earned points: only for fully paid bills, reduced by refunds, removed by a void
  const earnNet = sumPoints(entries, ["earn", "reverse_earn"]);
  let desiredEarn = earnNet;
  // Bills from before the loyalty programme started never earn points.
  if (metadata.loyalty_exempt === true) desiredEarn = earnNet;
  else if (reversed || bill.status === "void") desiredEarn = 0;
  else if (loyalty.enabled && metadata.payment_status === "paid") {
    const eligible = Math.max(0, Number(bill.subtotal || 0) - Number(metadata.discount_amount || 0) - Number(metadata.loyalty_discount || 0));
    desiredEarn = eligible >= loyalty.min_bill_amount
      ? Math.floor((eligible * keptShare * loyalty.earn_percent) / 100 / loyalty.point_value)
      : 0;
  } else if (loyalty.enabled && earnNet > 0 && keptShare < 1) {
    desiredEarn = Math.min(earnNet, Math.floor(earnNet * keptShare));
  }
  const earnDelta = desiredEarn - earnNet;
  if (earnDelta > 0) {
    current = await writeEntry(tx, current, { type: "earn", points: earnDelta, billId: bill.id, actor,
      expiresAt: loyalty.expiry_months ? addMonths(new Date(), loyalty.expiry_months) : null,
      note: `Earned on bill ${bill.invoiceNumber || bill.id}` });
  } else if (earnDelta < 0) {
    // Points already spent cannot be taken back twice; the balance never goes below zero.
    const takeBack = Math.min(-earnDelta, Math.max(0, current.loyaltyPoints));
    if (takeBack > 0) {
      current = await writeEntry(tx, current, { type: "reverse_earn", points: -takeBack, billId: bill.id, actor,
        note: `Taken back: bill ${bill.invoiceNumber || bill.id} ${bill.status === "void" ? "voided" : "refunded"}` });
    }
  }
  const finalEntries = await tx.loyaltyEntry.findMany({ where: { billId: bill.id, customerId: customer.id } });
  return {
    customer_stats: desiredStats,
    loyalty_points_earned: sumPoints(finalEntries, ["earn", "reverse_earn"]),
    loyalty_balance_after: current.loyaltyPoints,
  };
};

/** Manual correction by staff, always with a reason. */
export const adjustPoints = async ({ businessId, customerId, points, reason, actor }) => {
  const value = Number(points);
  if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 1000000) fail(400, "LOYALTY_POINTS_INVALID", "Points must be a non-zero whole number");
  const note = String(reason || "").trim();
  if (!note) fail(400, "REASON_REQUIRED", "Give a reason for changing points");
  return prisma.$transaction(async (tx) => {
    const found = await tx.customer.findFirst({ where: { id: String(customerId), businessId, anonymizedAt: null } });
    if (!found) fail(404, "CUSTOMER_NOT_FOUND", "Customer not found");
    const customer = await lockedBalance(tx, found.id);
    if (value < 0 && customer.loyaltyPoints < -value) fail(400, "LOYALTY_INSUFFICIENT", `${customer.name} has only ${customer.loyaltyPoints} points`);
    const { loyalty } = await getCustomerSettings(businessId, tx);
    return writeEntry(tx, customer, { type: "adjust", points: value, note, actor,
      expiresAt: value > 0 && loyalty.expiry_months ? addMonths(new Date(), loyalty.expiry_months) : null });
  });
};
