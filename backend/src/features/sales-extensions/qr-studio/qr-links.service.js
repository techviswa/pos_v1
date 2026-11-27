import { createHash, randomBytes } from "node:crypto";
import prisma from "../../../database/prisma/client.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { bindTenantScope } from "../../../database/prisma/tenant-context.js";
import { saasService } from "../../../core/saas/saas.service.js";
import { featureToggleService } from "../../../services/featureToggleService.js";
import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { qrOrderingService } from "../qr-ordering/qr-ordering.service.js";
import { qrBrandService } from "./qr-brand.service.js";

// Smart codes: a printed QR holds only /q/<token>. What it opens (browse menu, an offer, a review page, a contact
// card or any web page) is stored here and can be changed or switched off without reprinting.

export const LINK_KINDS = ["menu", "offer", "review", "card", "link"];
const MAX_LINKS = 200;
const fail = (message, statusCode = 400, code = "QR_LINK_INVALID") => { throw createHttpError({ statusCode, code, message }); };
const newToken = () => randomBytes(9).toString("base64url");
const visitorHash = (businessId, ip) => (ip ? createHash("sha256").update(`qr-link:${businessId}:${ip}`).digest("hex") : null);

const text = (value, limit, label, required = false) => {
  if (value === undefined || value === null || value === "") { if (required) fail(`Enter the ${label}`); return ""; }
  if (typeof value !== "string" || value.trim().length > limit) fail(`Keep the ${label} within ${limit} characters`);
  if (required && !value.trim()) fail(`Enter the ${label}`);
  return value.trim();
};
const httpsUrl = (value, label, required = true) => {
  if (!value && !required) return "";
  let url;
  try { url = new URL(String(value || "").trim()); } catch { fail(`Enter the ${label} as a full https:// address`); }
  if (url.protocol !== "https:") fail(`The ${label} must start with https://`);
  return url.href;
};
const phone = (value, label) => {
  const cleaned = text(value, 20, label);
  if (cleaned && !/^\+?[0-9 ()-]{6,20}$/.test(cleaned)) fail(`Enter the ${label} as digits, optionally starting with +`);
  return cleaned;
};

async function resolveOutlet(businessId, outletId) {
  if (outletId) {
    const outlet = await prisma.outlet.findFirst({ where: { id: String(outletId), businessId }, select: { id: true, status: true } });
    if (!outlet) fail("Outlet not found", 404);
    if (outlet.status !== "active") fail("This outlet is closed; choose an open outlet");
    return outlet.id;
  }
  const outlets = await prisma.outlet.findMany({ where: { businessId, status: "active" }, select: { id: true }, take: 2 });
  if (outlets.length > 1) fail("Choose which outlet's menu this code shows");
  return outlets[0]?.id || null;
}

/** Checks and cleans a code's settings for its kind. Returns { outletId, config }. */
export async function validateLink(businessId, kind, input = {}) {
  if (!LINK_KINDS.includes(kind)) fail(`Choose a code type: ${LINK_KINDS.join(", ")}`);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Send the code settings as an object");
  const config = { headline: text(input.headline, 80, "headline") };
  let outletId = input.outlet_id ? String(input.outlet_id) : null;
  if (kind === "menu" || kind === "offer") outletId = await resolveOutlet(businessId, outletId);
  else if (outletId) outletId = await resolveOutlet(businessId, outletId);
  if (kind === "offer") {
    const rule = await prisma.priceRule.findFirst({ where: { id: String(input.rule_id || ""), businessId }, select: { id: true, active: true } });
    if (!rule) fail("Choose one of your offers (Menu > Offers & happy hours)");
    if (!rule.active) fail("That offer is switched off; switch it on before printing a code for it");
    config.rule_id = rule.id;
  }
  if (kind === "review" || kind === "link") config.url = httpsUrl(input.url, kind === "review" ? "review page" : "web address");
  if (kind === "card") {
    Object.assign(config, {
      title: text(input.title, 60, "name", true), subtitle: text(input.subtitle, 80, "role or tagline"),
      phone: phone(input.phone, "phone number"), whatsapp: phone(input.whatsapp, "WhatsApp number"),
      email: text(input.email, 120, "email"), address: text(input.address, 160, "address"),
      website: httpsUrl(input.website, "website", false), instagram: text(input.instagram, 30, "Instagram handle").replace(/^@/, ""),
    });
    if (config.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) fail("Enter a valid email address");
    if (config.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(config.instagram)) fail("Enter the Instagram handle without spaces");
    if (!config.phone && !config.whatsapp && !config.email && !config.website && !config.address) fail("Add at least one way to reach you");
  }
  return { outletId, config };
}

const serialize = (link, stats = {}) => ({
  id: link.id, token: link.token, kind: link.kind, name: link.name, outlet_id: link.outletId, config: link.config, active: link.active,
  scan_count: link.scanCount, last_scanned_at: link.lastScannedAt?.toISOString() || null, scans_30d: stats[link.id] || 0,
  created_at: link.createdAt.toISOString(), updated_at: link.updatedAt.toISOString(),
});
const inScope = (outletScope, outletId) => !outletScope || (outletId && outletScope.includes(outletId));

const RULE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clock = (minute) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export function describeRule(rule) {
  const value = Number(rule.value);
  const deal = rule.discountType === "percent_off" ? `${value}% off` : rule.discountType === "amount_off" ? `₹${value} off` : `Special price ₹${value}`;
  const days = rule.daysOfWeek?.length && rule.daysOfWeek.length < 7 ? rule.daysOfWeek.map((day) => RULE_DAYS[day]).join(", ") : "Every day";
  const allDay = rule.startMinute === rule.endMinute || (rule.startMinute === 0 && rule.endMinute >= 1439);
  return { deal, days, hours: allDay ? "All day" : `${clock(rule.startMinute)}–${clock(rule.endMinute)}`, valid_to: rule.validTo ? rule.validTo.toISOString().slice(0, 10) : null };
}

export const qrLinksService = {
  async list({ businessId, outletScope }) {
    const links = await prisma.qrLink.findMany({ where: { businessId }, orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
    const visible = links.filter((link) => inScope(outletScope, link.outletId));
    const since = new Date(Date.now() - 30 * 86400000);
    const counts = await prisma.qrLinkScan.groupBy({ by: ["qrLinkId"], where: { businessId, scannedAt: { gte: since }, qrLinkId: { in: visible.map((link) => link.id) } }, _count: { _all: true } });
    const stats = Object.fromEntries(counts.map((row) => [row.qrLinkId, row._count._all]));
    return visible.map((link) => serialize(link, stats));
  },

  async create({ businessId, outletScope, payload = {} }) {
    const name = text(payload.name, 60, "code name", true);
    const { outletId, config } = await validateLink(businessId, payload.kind, payload.config || {});
    if (!inScope(outletScope, outletId)) fail("You can only create codes for your own outlet", 403, "OUTLET_ACCESS_DENIED");
    if (await prisma.qrLink.count({ where: { businessId } }) >= MAX_LINKS) fail(`A business can keep up to ${MAX_LINKS} smart codes; switch off and reuse old ones`, 409);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = newToken();
      if (await prisma.qrLink.findUnique({ where: { token }, select: { id: true } })) continue;
      return serialize(await prisma.qrLink.create({ data: { businessId, outletId, token, kind: payload.kind, name, config } }));
    }
    return fail("Could not create a unique code; try again", 503);
  },

  async update({ businessId, outletScope, linkId, payload = {} }) {
    const link = await prisma.qrLink.findFirst({ where: { id: linkId, businessId } });
    if (!link || !inScope(outletScope, link.outletId)) fail("Smart code not found", 404, "NOT_FOUND");
    const data = {};
    if (payload.name !== undefined) data.name = text(payload.name, 60, "code name", true);
    if (payload.active !== undefined) {
      if (typeof payload.active !== "boolean") fail("active must be true or false");
      data.active = payload.active;
    }
    // The kind is fixed: the printed code keeps its token, only where it leads changes.
    if (payload.config !== undefined) {
      const { outletId, config } = await validateLink(businessId, link.kind, payload.config);
      if (!inScope(outletScope, outletId)) fail("You can only point codes at your own outlet", 403, "OUTLET_ACCESS_DENIED");
      Object.assign(data, { outletId, config });
    }
    return serialize(await prisma.qrLink.update({ where: { id: link.id }, data }));
  },

  /** Public: what a scanned smart code opens. Records the scan unless the page is only refreshing. */
  async resolve({ token, requestMeta = {} }) {
    const link = await prisma.qrLink.findUnique({ where: { token: String(token || "") }, include: { business: { select: { id: true, name: true, tenantId: true } } } });
    if (!link || !link.active) fail("This QR code is no longer active. Please ask the staff.", 404, "QR_LINK_INACTIVE");
    const access = await saasService.getAccessMode(link.businessId);
    if (access.mode === "blocked") fail("This business is unavailable right now", 403, "TENANT_SUSPENDED");
    if (!await featureToggleService.isFeatureEnabled(FEATURE_KEYS.QR_STUDIO, link.businessId)) fail("This QR code is not active right now. Please ask the staff.", 404, "QR_LINK_INACTIVE");
    bindTenantScope({ businessId: link.businessId, tenantId: link.business.tenantId });
    if (!requestMeta.refresh) {
      await prisma.$transaction(async (tx) => {
        await tx.qrLink.update({ where: { id: link.id }, data: { scanCount: { increment: 1 }, lastScannedAt: new Date() } });
        await tx.qrLinkScan.create({ data: { qrLinkId: link.id, businessId: link.businessId, userAgent: requestMeta.userAgent ? String(requestMeta.userAgent).slice(0, 300) : null, ipHash: visitorHash(link.businessId, requestMeta.ipAddress) } });
      });
    }
    const outlet = link.outletId ? await prisma.outlet.findFirst({ where: { id: link.outletId, businessId: link.businessId }, select: { id: true, name: true, status: true } }) : null;
    const base = { kind: link.kind, name: link.name, headline: link.config.headline || "", business: { name: link.business.name }, outlet: outlet ? { name: outlet.name } : null,
      brand: await qrBrandService.publicBrand({ businessId: link.businessId, outletId: link.outletId }) };
    if (link.kind === "review" || link.kind === "link") return { ...base, url: link.config.url };
    if (link.kind === "card") { const { headline, ...card } = link.config; return { ...base, card }; }
    if (outlet && outlet.status !== "active") return { ...base, unavailable: "This outlet is closed right now." };
    const items = await qrOrderingService.buildGuestMenuItems({ businessId: link.businessId, outletId: link.outletId });
    if (link.kind === "menu") return { ...base, items };
    const rule = await prisma.priceRule.findFirst({ where: { id: link.config.rule_id, businessId: link.businessId } });
    if (!rule || !rule.active || (rule.validTo && rule.validTo < new Date())) return { ...base, unavailable: "This offer has ended. Here is our menu.", items };
    const targets = (item) => (!rule.productIds.length && !rule.categories.length) || rule.productIds.includes(item.id) || rule.categories.includes(item.category);
    const offerItems = items.filter(targets);
    return { ...base, offer: { name: rule.name, ...describeRule(rule), active_now: offerItems.some((item) => item.price_rule?.id === rule.id) }, items: offerItems };
  },
};
