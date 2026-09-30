import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { syncService } from "../sync/sync.service.js";
import {
  adjustPoints, getCustomerSettings, lockedBalance, normalizePhone, saveCustomerSettings,
} from "./customer-core.js";
import { cardState, maskCode } from "./gift-cards.service.js";

const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const toIso = (value) => (value ? value.toISOString() : null);
const dayOnly = (value) => (value ? value.toISOString().slice(0, 10) : null);

const serializeCustomer = (customer) => ({
  id: customer.id,
  phone: customer.anonymizedAt ? null : customer.phone,
  name: customer.name,
  email: customer.email,
  birthday: dayOnly(customer.birthday),
  anniversary: dayOnly(customer.anniversary),
  gender: customer.gender,
  notes: customer.notes,
  tags: customer.tags || [],
  marketing_opt_in: customer.marketingOptIn,
  marketing_consent_at: toIso(customer.marketingConsentAt),
  marketing_opt_out_at: toIso(customer.marketingOptOutAt),
  loyalty_points: customer.loyaltyPoints,
  visit_count: customer.visitCount,
  total_spent: Number(customer.totalSpent || 0),
  average_spend: customer.visitCount ? Math.round((Number(customer.totalSpent || 0) / customer.visitCount) * 100) / 100 : 0,
  first_visit_at: toIso(customer.firstVisitAt),
  last_visit_at: toIso(customer.lastVisitAt),
  anonymized: Boolean(customer.anonymizedAt),
  created_at: toIso(customer.createdAt),
});

/** Optional calendar date (birthday/anniversary). Stored at noon UTC so it never shifts a day in any timezone. */
const parseDay = (value, field) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(match[3]) || date > new Date()) fail(400, "DATE_INVALID", `${field} is not a valid past date (YYYY-MM-DD)`);
  return date;
};

const profileData = (payload, { creating = false } = {}) => {
  const data = {};
  if (payload.name !== undefined || creating) {
    const name = String(payload.name || "").trim();
    if (!name) fail(400, "NAME_REQUIRED", "Enter the customer's name");
    data.name = name.slice(0, 120);
  }
  if (payload.email !== undefined) {
    const email = String(payload.email || "").trim().toLowerCase();
    if (email && !EMAIL_PATTERN.test(email)) fail(400, "EMAIL_INVALID", "Enter a valid email address");
    data.email = email || null;
  }
  const birthday = parseDay(payload.birthday, "Birthday");
  if (birthday !== undefined) data.birthday = birthday;
  const anniversary = parseDay(payload.anniversary, "Anniversary");
  if (anniversary !== undefined) data.anniversary = anniversary;
  if (payload.gender !== undefined) data.gender = payload.gender ? String(payload.gender).slice(0, 30) : null;
  if (payload.notes !== undefined) data.notes = payload.notes ? String(payload.notes).slice(0, 1000) : null;
  if (payload.tags !== undefined) {
    if (!Array.isArray(payload.tags) || payload.tags.length > 15) fail(400, "TAGS_INVALID", "Tags must be a list of at most 15");
    data.tags = [...new Set(payload.tags.map((tag) => String(tag).trim().slice(0, 30)).filter(Boolean))];
  }
  if (payload.marketing_opt_in !== undefined) {
    data.marketingOptIn = Boolean(payload.marketing_opt_in);
    if (data.marketingOptIn) Object.assign(data, { marketingConsentAt: new Date(), marketingOptOutAt: null });
    else data.marketingOptOutAt = new Date();
  }
  return data;
};

/** Days until the next occurrence of a yearly date (0 = today). */
const daysUntil = (date, now = new Date()) => {
  if (!date) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (next < today) next = new Date(now.getFullYear() + 1, date.getUTCMonth(), date.getUTCDate());
  return Math.round((next - today) / 86400000);
};

class CustomersService {
  /** AdminCore export (unchanged contract), enriched with profile fields where a profile exists. */
  async listCustomers({ tenantId, businessId, query = {} }) {
    const data = await syncService.exportResource({ resource: "customers", tenantId, businessId, query });
    const profiles = await prisma.customer.findMany({ where: { businessId, anonymizedAt: null } });
    const byPhone = new Map(profiles.map((profile) => [profile.phone, profile]));
    const items = (data.items || []).map((row) => {
      const profile = byPhone.get(normalizePhone(row.phone));
      return profile ? { ...row, customer_profile_id: profile.id, email: profile.email, loyalty_points: profile.loyaltyPoints, marketing_opt_in: profile.marketingOptIn } : row;
    });
    return { items, meta: data.meta };
  }

  async search({ businessId, query = {} }) {
    const search = String(query.search || "").trim();
    const digits = search.replace(/\D/g, "");
    const where = { businessId, anonymizedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ];
    }
    if (query.tag) where.tags = { has: String(query.tag) };
    const sortable = { recent: { lastVisitAt: "desc" }, spend: { totalSpent: "desc" }, visits: { visitCount: "desc" }, points: { loyaltyPoints: "desc" }, name: { name: "asc" } };
    let rows = await prisma.customer.findMany({ where, orderBy: [sortable[query.sort] || sortable.recent, { createdAt: "desc" }], take: 500 });
    const within = Number(query.celebrations);
    if (Number.isInteger(within) && within >= 0 && within <= 60) {
      rows = rows.filter((row) => [daysUntil(row.birthday), daysUntil(row.anniversary)].some((days) => days !== null && days <= within));
    }
    if (query.inactive_days) {
      const cutoff = new Date(Date.now() - Number(query.inactive_days) * 86400000);
      rows = rows.filter((row) => row.lastVisitAt && row.lastVisitAt < cutoff);
    }
    return rows.map((row) => ({ ...serializeCustomer(row), birthday_in_days: daysUntil(row.birthday), anniversary_in_days: daysUntil(row.anniversary) }));
  }

  /** What the till needs: who this is and what they can redeem. Expired points are cleared first. */
  async lookup({ businessId, phone }) {
    const normalized = normalizePhone(phone);
    if (!normalized) fail(400, "PHONE_INVALID", "Enter a valid phone number");
    const settings = await getCustomerSettings(businessId);
    const found = await prisma.customer.findUnique({ where: { businessId_phone: { businessId, phone: normalized } } });
    if (!found) return { found: false, phone: normalized, loyalty: settings.loyalty };
    const customer = await prisma.$transaction((tx) => lockedBalance(tx, found.id));
    const redeemable = settings.loyalty.enabled && customer.loyaltyPoints >= settings.loyalty.min_redeem_points ? customer.loyaltyPoints : 0;
    return {
      found: true,
      customer: { id: customer.id, name: customer.name, phone: customer.phone, loyalty_points: customer.loyaltyPoints, visit_count: customer.visitCount,
        last_visit_at: toIso(customer.lastVisitAt), tags: customer.tags, notes: customer.notes, birthday_in_days: daysUntil(customer.birthday),
        marketing_opt_in: customer.marketingOptIn,
        anniversary_in_days: daysUntil(customer.anniversary) },
      redeemable_points: redeemable,
      redeemable_value: Math.round(redeemable * settings.loyalty.point_value * 100) / 100,
      loyalty: settings.loyalty,
    };
  }

  async get({ businessId, customerId }) {
    const found = await prisma.customer.findFirst({ where: { id: String(customerId), businessId } });
    if (!found) fail(404, "CUSTOMER_NOT_FOUND", "Customer not found");
    const customer = found.anonymizedAt ? found : await prisma.$transaction((tx) => lockedBalance(tx, found.id));
    const [entries, cards, bills] = await Promise.all([
      prisma.loyaltyEntry.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.giftCard.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" } }),
      prisma.bill.findMany({
        where: { businessId, metadata: { path: ["customer_id"], equals: customer.id } },
        include: { items: true }, orderBy: { createdAt: "desc" }, take: 100,
      }),
    ]);
    const favourites = new Map();
    for (const bill of bills.filter((row) => row.status !== "void")) {
      for (const item of bill.items) {
        const key = item.productId || item.name;
        const row = favourites.get(key) || { product_id: item.productId, name: item.name, quantity: 0 };
        row.quantity += item.quantity;
        favourites.set(key, row);
      }
    }
    const productNames = new Map((await prisma.product.findMany({
      where: { businessId, id: { in: [...favourites.values()].map((row) => row.product_id).filter(Boolean) } }, select: { id: true, name: true },
    })).map((row) => [row.id, row.name]));
    for (const row of favourites.values()) if (row.product_id && productNames.has(row.product_id)) row.name = productNames.get(row.product_id);
    const expiring = entries.filter((entry) => entry.points > 0 && entry.expiresAt && entry.expiresAt > new Date()).sort((a, b) => a.expiresAt - b.expiresAt)[0];
    return {
      ...serializeCustomer(customer),
      next_points_expiry: expiring ? toIso(expiring.expiresAt) : null,
      loyalty_history: entries.map((entry) => ({ id: entry.id, type: entry.type, points: entry.points, value: entry.value === null ? null : Number(entry.value),
        balance_after: entry.balanceAfter, bill_id: entry.billId, expires_at: toIso(entry.expiresAt), note: entry.note, created_by_name: entry.createdByName, created_at: toIso(entry.createdAt) })),
      gift_cards: cards.map((card) => ({ id: card.id, code: maskCode(card.code), balance: Number(card.balance), status: cardState(card), expires_at: toIso(card.expiresAt) })),
      bills: bills.map((bill) => ({ id: bill.id, invoice_number: bill.invoiceNumber, total: Number(bill.total), status: bill.status,
        payment_status: bill.metadata?.payment_status || null, points_earned: bill.metadata?.loyalty_points_earned || 0,
        points_redeemed: bill.metadata?.loyalty_redeem_points || 0, created_at: toIso(bill.createdAt) })),
      favourites: [...favourites.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 8),
    };
  }

  async create({ businessId, payload = {} }) {
    const phone = normalizePhone(payload.phone);
    if (!phone) fail(400, "PHONE_INVALID", "Enter a valid phone number");
    const data = profileData(payload, { creating: true });
    try {
      return serializeCustomer(await prisma.customer.create({ data: { businessId, phone, ...data } }));
    } catch (error) {
      if (error.code === "P2002") fail(409, "CUSTOMER_EXISTS", "A customer with this phone number already exists");
      throw error;
    }
  }

  async update({ businessId, customerId, payload = {} }) {
    const customer = await prisma.customer.findFirst({ where: { id: String(customerId), businessId, anonymizedAt: null } });
    if (!customer) fail(404, "CUSTOMER_NOT_FOUND", "Customer not found");
    const data = profileData(payload);
    if (payload.phone !== undefined) {
      const phone = normalizePhone(payload.phone);
      if (!phone) fail(400, "PHONE_INVALID", "Enter a valid phone number");
      data.phone = phone;
    }
    try {
      return serializeCustomer(await prisma.customer.update({ where: { id: customer.id }, data }));
    } catch (error) {
      if (error.code === "P2002") fail(409, "CUSTOMER_EXISTS", "Another customer already has this phone number");
      throw error;
    }
  }

  async adjust({ businessId, customerId, payload = {}, actor }) {
    const updated = await adjustPoints({ businessId, customerId, points: payload.points, reason: payload.reason, actor });
    return serializeCustomer(updated);
  }

  /**
   * Erase personal data on the guest's request. Bills keep their amounts (tax records) but no longer point to a
   * person; points are forfeited and gift cards are unlinked (the card itself still works for whoever holds it).
   */
  async anonymize({ businessId, customerId, actor, payload = {} }) {
    const reason = String(payload.reason || "").trim();
    if (!reason) fail(400, "REASON_REQUIRED", "Record why the data is being erased (e.g. customer request)");
    return prisma.$transaction(async (tx) => {
      const found = await tx.customer.findFirst({ where: { id: String(customerId), businessId, anonymizedAt: null } });
      if (!found) fail(404, "CUSTOMER_NOT_FOUND", "Customer not found");
      const customer = await lockedBalance(tx, found.id);
      if (customer.loyaltyPoints > 0) {
        await tx.loyaltyEntry.create({ data: { businessId, customerId: customer.id, type: "adjust", points: -customer.loyaltyPoints, balanceAfter: 0,
          note: "Forfeited: personal data erased", createdById: actor?.id || null, createdByName: actor?.name || null } });
      }
      await tx.giftCard.updateMany({ where: { customerId: customer.id }, data: { customerId: null } });
      const bills = await tx.bill.findMany({ where: { businessId, metadata: { path: ["customer_id"], equals: customer.id } }, select: { id: true, metadata: true } });
      for (const bill of bills) {
        await tx.bill.update({ where: { id: bill.id }, data: { customerName: "Erased customer",
          metadata: { ...bill.metadata, customer_name: "Erased customer", customer_phone: null } } });
      }
      const erased = await tx.customer.update({ where: { id: customer.id }, data: {
        phone: `erased-${customer.id}`, name: "Erased customer", email: null, birthday: null, anniversary: null, gender: null,
        notes: `Erased on request by ${actor?.name || "staff"}: ${reason.slice(0, 200)}`, tags: [], marketingOptIn: false, loyaltyPoints: 0, anonymizedAt: new Date(),
      } });
      return serializeCustomer(erased);
    });
  }

  getSettings({ businessId }) {
    return getCustomerSettings(businessId);
  }

  saveSettings({ businessId, payload }) {
    return saveCustomerSettings(businessId, payload);
  }

  async stats({ businessId }) {
    const [count, points, repeat] = await Promise.all([
      prisma.customer.count({ where: { businessId, anonymizedAt: null } }),
      prisma.customer.aggregate({ where: { businessId, anonymizedAt: null }, _sum: { loyaltyPoints: true } }),
      prisma.customer.count({ where: { businessId, anonymizedAt: null, visitCount: { gte: 2 } } }),
    ]);
    const settings = await getCustomerSettings(businessId);
    const outstandingPoints = points._sum.loyaltyPoints || 0;
    return {
      customers: count,
      repeat_customers: repeat,
      outstanding_points: outstandingPoints,
      outstanding_points_value: Math.round(outstandingPoints * settings.loyalty.point_value * 100) / 100,
    };
  }
}

export const customersService = new CustomersService();
