import { randomInt } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { ensureOpenShift, lockSettlement } from "../billing/settlement.service.js";
import { publishChange } from "../../services/realtime/realtime.service.js";
import { addMonths, getCustomerSettings, upsertCustomerForBill } from "./customer-core.js";

/**
 * Gift cards (closed-loop, usable only at this business).
 *
 * Selling a card is not a sale of food: no GST is charged when it is sold. GST is charged on the bill it pays for,
 * as with any payment method. A card sold for cash is active at once; one sold by UPI/card waits until an
 * Owner/Manager confirms the payment arrived. The balance only changes through transactions, under a per-card lock.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GIFT_METHOD = "gift card";
const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
const isManager = (user) => ["owner", "manager"].includes(String(user?.role || "").trim().toLowerCase().replace(/^system[\s_-]+owner$/, "owner"));

export const isGiftCardMethod = (method) => String(method || "").trim().toLowerCase() === GIFT_METHOD;
export const normalizeCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (code) => normalizeCode(code).replace(/(.{4})(?=.)/g, "$1-");
export const maskCode = (code) => `****-${normalizeCode(code).slice(-4)}`;
const newCode = () => Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const lockCard = (tx, cardId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gift-card:${cardId}`}))`;

export const cardState = (card, now = new Date()) => {
  if (card.status !== "active") return card.status;
  return card.expiresAt && card.expiresAt <= now ? "expired" : "active";
};

const serializeCard = (card, { full = false } = {}) => ({
  id: card.id,
  code: full ? formatCode(card.code) : maskCode(card.code),
  last4: normalizeCode(card.code).slice(-4),
  initial_value: Number(card.initialValue),
  balance: Number(card.balance),
  status: cardState(card),
  expires_at: card.expiresAt ? card.expiresAt.toISOString() : null,
  customer_id: card.customerId,
  customer_name: card.customer?.name || null,
  recipient_name: card.recipientName,
  recipient_phone: card.recipientPhone,
  outlet_id: card.outletId,
  note: card.note,
  created_by_name: card.createdByName,
  created_at: card.createdAt.toISOString(),
  transactions: card.transactions?.map((row) => ({
    id: row.id, type: row.type, amount: Number(row.amount), balance_after: Number(row.balanceAfter), bill_id: row.billId,
    payment_method: row.paymentMethod, payment_reference: row.paymentReference, note: row.note,
    created_by_name: row.createdByName, created_at: row.createdAt.toISOString(),
  })),
});

const parseAmount = (value, settings, field = "Amount") => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) fail(400, "GIFT_CARD_AMOUNT_INVALID", `${field} must be a positive amount with at most 2 decimals`);
  if (settings && (amount < settings.min_value || amount > settings.max_value)) fail(400, "GIFT_CARD_AMOUNT_INVALID", `${field} must be between ${settings.min_value} and ${settings.max_value}`);
  return roundMoney(amount);
};

const paymentOf = (payload) => {
  const method = String(payload.payment_method || "Cash").trim().slice(0, 30);
  if (!method || isGiftCardMethod(method)) fail(400, "GIFT_CARD_PAYMENT_INVALID", "Choose how the customer paid for the card");
  const cash = method.toLowerCase() === "cash";
  const reference = String(payload.payment_reference || "").trim().slice(0, 80) || null;
  if (!cash && !reference) fail(400, "PAYMENT_REFERENCE_REQUIRED", "Enter the UPI/card transaction reference");
  return { method, cash, reference };
};

/** Load a card for a bill payment or refund, locked, and check it may be used. */
export const loadCardForUse = async (tx, { businessId, code, cardId }) => {
  const where = cardId ? { id: cardId } : { code: normalizeCode(code) };
  if (!cardId && normalizeCode(code).length !== 16) fail(404, "GIFT_CARD_NOT_FOUND", "Gift card not found");
  const found = await tx.giftCard.findUnique({ where, select: { id: true, businessId: true } });
  if (!found || found.businessId !== businessId) fail(404, "GIFT_CARD_NOT_FOUND", "Gift card not found");
  await lockCard(tx, found.id);
  return tx.giftCard.findUnique({ where: { id: found.id } });
};

/** Takes `amount` off a card as payment for a bill. Returns the payment row for the bill. */
export const redeemForBill = async (tx, { businessId, code, amount, billId, actor, outletId }) => {
  const card = await loadCardForUse(tx, { businessId, code });
  const state = cardState(card);
  if (state !== "active") fail(409, "GIFT_CARD_NOT_USABLE", state === "pending_payment" ? "This card's payment has not been confirmed yet" : `This gift card is ${state}`);
  const value = roundMoney(amount);
  if (!(value > 0)) fail(400, "GIFT_CARD_AMOUNT_INVALID", "Gift card payment must be positive");
  if (Number(card.balance) < value) fail(409, "GIFT_CARD_INSUFFICIENT", `This card has only ${Number(card.balance).toFixed(2)} left`);
  const updated = await tx.giftCard.update({ where: { id: card.id }, data: { balance: { decrement: value } } });
  await tx.giftCardTransaction.create({ data: {
    businessId, giftCardId: card.id, type: "redeem", amount: -value, balanceAfter: updated.balance, billId, outletId: outletId || null,
    createdById: actor?.id || null, createdByName: actor?.name || null,
  } });
  return { card: updated, reference: `GC ${maskCode(card.code)}` };
};

/** Puts refunded money back on the cards a bill was paid with (never more than was taken from each). */
export const refundToCards = async (tx, { businessId, bill, amount, actor }) => {
  let left = roundMoney(amount);
  const used = (bill.metadata?.payments || []).filter((payment) => payment.gift_card_id && payment.status === "confirmed");
  for (const payment of used) {
    if (left <= 0) break;
    const alreadyBack = (await tx.giftCardTransaction.findMany({ where: { giftCardId: payment.gift_card_id, billId: bill.id, type: "refund" } }))
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const room = roundMoney(Number(payment.amount) - alreadyBack);
    if (room <= 0) continue;
    const card = await loadCardForUse(tx, { businessId, cardId: payment.gift_card_id });
    if (card.status === "void") continue;
    const back = Math.min(room, left);
    const updated = await tx.giftCard.update({ where: { id: card.id }, data: { balance: { increment: back } } });
    await tx.giftCardTransaction.create({ data: {
      businessId, giftCardId: card.id, type: "refund", amount: back, balanceAfter: updated.balance, billId: bill.id,
      note: "Bill refund", createdById: actor?.id || null, createdByName: actor?.name || null,
    } });
    left = roundMoney(left - back);
  }
  if (left > 0) fail(400, "GIFT_CARD_REFUND_EXCEEDS", "Only the amount paid by gift card can be refunded to gift cards; refund the rest another way");
};

class GiftCardsService {
  async sell({ businessId, actor, payload = {} }) {
    const { gift_cards: settings } = await getCustomerSettings(businessId);
    const amount = parseAmount(payload.amount, settings);
    const payment = paymentOf(payload);
    const requestId = String(payload.client_request_id || "").trim().slice(0, 80) || null;
    const outletId = payload.outlet_id ? String(payload.outlet_id) : null;
    const result = await prisma.$transaction(async (tx) => {
      await lockSettlement(tx, businessId);
      if (requestId) {
        const earlier = await tx.giftCardTransaction.findUnique({ where: { businessId_clientRequestId: { businessId, clientRequestId: requestId } } });
        if (earlier) return { card: await tx.giftCard.findUnique({ where: { id: earlier.giftCardId } }), replayed: true };
      }
      const shift = await ensureOpenShift(tx, businessId, outletId, actor);
      const customer = payload.customer_phone ? await upsertCustomerForBill(tx, { businessId, phone: payload.customer_phone, name: payload.customer_name }) : null;
      if (payload.customer_phone && !customer) fail(400, "PHONE_INVALID", "Enter a valid phone number");
      let code = newCode();
      while (await tx.giftCard.findUnique({ where: { code }, select: { id: true } })) code = newCode();
      const card = await tx.giftCard.create({ data: {
        businessId, code, initialValue: amount, balance: amount, status: payment.cash ? "active" : "pending_payment",
        expiresAt: settings.expiry_months ? addMonths(new Date(), settings.expiry_months) : null,
        customerId: customer?.id || null,
        recipientName: payload.recipient_name ? String(payload.recipient_name).slice(0, 120) : null,
        recipientPhone: payload.recipient_phone ? String(payload.recipient_phone).replace(/[^\d+]/g, "").slice(0, 20) : null,
        outletId, note: payload.note ? String(payload.note).slice(0, 300) : null,
        createdById: actor?.id || null, createdByName: actor?.name || null,
      } });
      await tx.giftCardTransaction.create({ data: {
        businessId, giftCardId: card.id, type: "issue", amount, balanceAfter: amount, paymentMethod: payment.method,
        paymentReference: payment.reference, settlementShiftId: shift.id, outletId, clientRequestId: requestId,
        createdById: actor?.id || null, createdByName: actor?.name || null,
      } });
      await publishChange({ businessId, resource: "gift_cards", action: "sold", recordId: card.id, outletId }, { tx });
      return { card, replayed: false };
    });
    // The full code is shown once, to the person who sold it, so it can be handed to the customer.
    return { ...serializeCard(result.card, { full: true }), replayed: result.replayed };
  }

  async reload({ businessId, actor, cardId, payload = {} }) {
    const { gift_cards: settings } = await getCustomerSettings(businessId);
    const amount = parseAmount(payload.amount, null, "Top-up");
    const payment = paymentOf(payload);
    if (!payment.cash && !isManager(actor)) fail(403, "MANAGER_REQUIRED", "Only an Owner or Manager can top up a card by UPI/card");
    return prisma.$transaction(async (tx) => {
      await lockSettlement(tx, businessId);
      const card = await loadCardForUse(tx, { businessId, cardId: String(cardId) });
      if (cardState(card) !== "active") fail(409, "GIFT_CARD_NOT_USABLE", `This gift card is ${cardState(card)}`);
      if (Number(card.balance) + amount > settings.max_value) fail(400, "GIFT_CARD_AMOUNT_INVALID", `A card can hold at most ${settings.max_value}`);
      const shift = await ensureOpenShift(tx, businessId, card.outletId, actor);
      const updated = await tx.giftCard.update({ where: { id: card.id }, data: { balance: { increment: amount } } });
      await tx.giftCardTransaction.create({ data: {
        businessId, giftCardId: card.id, type: "issue", amount, balanceAfter: updated.balance, paymentMethod: payment.method,
        paymentReference: payment.reference, settlementShiftId: shift.id, outletId: card.outletId, note: "Top-up",
        createdById: actor?.id || null, createdByName: actor?.name || null,
      } });
      return serializeCard(updated);
    });
  }

  async confirmPayment({ businessId, actor, cardId, payload = {} }) {
    if (!isManager(actor)) fail(403, "MANAGER_REQUIRED", "Only an Owner or Manager can confirm a card payment");
    return prisma.$transaction(async (tx) => {
      const card = await loadCardForUse(tx, { businessId, cardId: String(cardId) });
      if (card.status !== "pending_payment") fail(409, "GIFT_CARD_NOT_PENDING", "This card is not waiting for payment");
      const updated = await tx.giftCard.update({ where: { id: card.id }, data: { status: "active" } });
      await tx.giftCardTransaction.create({ data: {
        businessId, giftCardId: card.id, type: "adjust", amount: 0, balanceAfter: updated.balance,
        note: `Payment confirmed${payload.reference ? `: ${String(payload.reference).slice(0, 80)}` : ""}`,
        createdById: actor.id, createdByName: actor.name || null,
      } });
      return serializeCard(updated);
    });
  }

  async setBlocked({ businessId, actor, cardId, blocked, reason }) {
    const note = String(reason || "").trim();
    if (!note) fail(400, "REASON_REQUIRED", "Give a reason");
    return prisma.$transaction(async (tx) => {
      const card = await loadCardForUse(tx, { businessId, cardId: String(cardId) });
      if (blocked && card.status !== "active") fail(409, "GIFT_CARD_NOT_USABLE", `This gift card is ${cardState(card)}`);
      if (!blocked && card.status !== "blocked") fail(409, "GIFT_CARD_NOT_BLOCKED", "This card is not blocked");
      const updated = await tx.giftCard.update({ where: { id: card.id }, data: { status: blocked ? "blocked" : "active" } });
      await tx.giftCardTransaction.create({ data: {
        businessId, giftCardId: card.id, type: "adjust", amount: 0, balanceAfter: updated.balance, note: `${blocked ? "Blocked" : "Unblocked"}: ${note.slice(0, 250)}`,
        createdById: actor.id, createdByName: actor.name || null,
      } });
      return serializeCard(updated);
    });
  }

  /** Cancels a card and pays out what is left on it (e.g. sold by mistake). */
  async voidCard({ businessId, actor, cardId, payload = {} }) {
    if (!isManager(actor)) fail(403, "MANAGER_REQUIRED", "Only an Owner or Manager can void a gift card");
    const note = String(payload.reason || "").trim();
    if (!note) fail(400, "REASON_REQUIRED", "Give a reason");
    return prisma.$transaction(async (tx) => {
      await lockSettlement(tx, businessId);
      const card = await loadCardForUse(tx, { businessId, cardId: String(cardId) });
      if (card.status === "void") fail(409, "GIFT_CARD_VOID", "This card is already void");
      const balance = Number(card.balance);
      // A card never paid for (pending) returns nothing; otherwise the remaining balance goes back to the customer.
      const refundMethod = card.status === "pending_payment" || balance === 0 ? null : String(payload.refund_method || "Cash").trim().slice(0, 30);
      if (refundMethod && isGiftCardMethod(refundMethod)) fail(400, "GIFT_CARD_PAYMENT_INVALID", "Choose how the balance is returned");
      const shift = refundMethod ? await ensureOpenShift(tx, businessId, card.outletId, actor) : null;
      const updated = await tx.giftCard.update({ where: { id: card.id }, data: { status: "void", balance: 0 } });
      await tx.giftCardTransaction.create({ data: {
        businessId, giftCardId: card.id, type: "void", amount: -balance, balanceAfter: 0, paymentMethod: refundMethod,
        settlementShiftId: shift?.id || null, outletId: card.outletId, note: note.slice(0, 300),
        createdById: actor.id, createdByName: actor.name || null,
      } });
      return serializeCard(updated);
    });
  }

  /** What the till needs to take a card as payment. */
  async lookup({ businessId, code }) {
    const card = await prisma.giftCard.findUnique({ where: { code: normalizeCode(code) } });
    if (!card || card.businessId !== businessId) fail(404, "GIFT_CARD_NOT_FOUND", "Gift card not found");
    const { id, code: masked, balance, status, expires_at: expiresAt } = serializeCard(card);
    return { id, code: masked, balance, status, expires_at: expiresAt };
  }

  async list({ businessId, query = {} }) {
    const search = String(query.search || "").trim();
    const where = { businessId };
    if (search) {
      const digits = search.replace(/\D/g, "");
      where.OR = [
        { code: { endsWith: normalizeCode(search).slice(-4) || "____" } },
        { recipientName: { contains: search, mode: "insensitive" } },
        ...(digits.length >= 4 ? [{ recipientPhone: { contains: digits } }, { customer: { phone: { contains: digits } } }] : []),
        { customer: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
    const cards = await prisma.giftCard.findMany({ where, include: { customer: true }, orderBy: { createdAt: "desc" }, take: 300 });
    const rows = cards.map((card) => serializeCard(card));
    const status = String(query.status || "");
    return status ? rows.filter((row) => row.status === status) : rows;
  }

  async get({ businessId, cardId }) {
    const card = await prisma.giftCard.findFirst({ where: { id: String(cardId), businessId }, include: { customer: true, transactions: { orderBy: { createdAt: "desc" } } } });
    if (!card) fail(404, "GIFT_CARD_NOT_FOUND", "Gift card not found");
    return serializeCard(card);
  }

  /** Outstanding liability: money received for cards not yet spent. */
  async summary({ businessId }) {
    const cards = await prisma.giftCard.findMany({ where: { businessId }, select: { status: true, balance: true, initialValue: true, expiresAt: true } });
    const now = new Date();
    const totals = { active_count: 0, outstanding: 0, expired_unspent: 0, pending_payment: 0 };
    for (const card of cards) {
      const state = cardState(card, now);
      if (state === "active") { totals.active_count += 1; totals.outstanding += Number(card.balance); }
      if (state === "expired") totals.expired_unspent += Number(card.balance);
      if (state === "pending_payment") totals.pending_payment += Number(card.balance);
    }
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, key.endsWith("count") ? value : roundMoney(value)]));
  }
}

export const giftCardsService = new GiftCardsService();
