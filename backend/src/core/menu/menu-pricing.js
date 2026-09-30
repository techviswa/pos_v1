import { createHttpError } from "../../shared/utils/http-error.js";

/**
 * The one place a sellable price is decided. Used by the menu APIs (what staff and guests see), billing, orders and
 * QR ordering (what is charged), so the displayed and charged prices can never disagree.
 *
 * Unit price = base + variation + add-ons + modifier options, where
 *   base = outlet price override  (OutletProduct.priceOverride)
 *        | channel price           (product.channelSettings[channel].price)
 *        | product price
 * and then the best matching price rule (happy hour etc.) is applied to the base only.
 */
export const MENU_CHANNELS = ["Dine-In", "Takeaway", "Delivery"];
// Price rules can also target QR self-ordering specifically.
export const RULE_CHANNELS = [...MENU_CHANNELS, "QR"];
export const DISCOUNT_TYPES = ["percent_off", "amount_off", "fixed_price"];

const SERVICE_MODE_CHANNEL = { TABLE: "Dine-In", TOKEN: "Takeaway", PICKUP: "Takeaway", DELIVERY: "Delivery" };
const ORDER_TYPE_CHANNEL = { "dine-in": "Dine-In", dinein: "Dine-In", takeaway: "Takeaway", pickup: "Takeaway", delivery: "Delivery" };

export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const bad = (code, message) => createHttpError({ statusCode: 400, code, message });

/** Menu channel for a sale, from an explicit menu_channel, the fulfilment mode, or the order type. */
export const resolveMenuChannel = (payload = {}) => {
  if (MENU_CHANNELS.includes(payload.menu_channel)) return payload.menu_channel;
  const byMode = SERVICE_MODE_CHANNEL[String(payload.service_mode || "").toUpperCase()];
  if (byMode) return byMode;
  return ORDER_TYPE_CHANNEL[String(payload.order_type || "").trim().toLowerCase()] || "Dine-In";
};

// ---------------------------------------------------------------------------------------------------- time windows

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map();

export const isValidTimeZone = (timeZone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** Day of week (0 = Sunday) and minutes after midnight in the given time zone. */
export const localClock = (at, timeZone) => {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatterCache.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  return { day: WEEKDAYS[parts.weekday], minute: Number(parts.hour) * 60 + Number(parts.minute) };
};

/** True when `at` falls inside the rule's weekly window (windows may run past midnight). */
export const isRuleTimeActive = (rule, at) => {
  if (rule.validFrom && at < new Date(rule.validFrom)) return false;
  if (rule.validTo && at > new Date(rule.validTo)) return false;
  const { day, minute } = localClock(at, rule.timezone || "Asia/Kolkata");
  const days = Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length ? rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
  const start = Number(rule.startMinute);
  const end = Number(rule.endMinute);
  if (start === end) return days.includes(day); // all day
  if (start < end) return days.includes(day) && minute >= start && minute < end;
  // Overnight: the part before midnight belongs to today, the part after midnight to the day it started.
  if (minute >= start) return days.includes(day);
  if (minute < end) return days.includes((day + 6) % 7);
  return false;
};

const ruleAppliesTo = (rule, { product, outletId, salesChannel, at }) =>
  rule.active !== false &&
  (!rule.channels?.length || rule.channels.includes(salesChannel)) &&
  (!rule.outletIds?.length || (outletId && rule.outletIds.includes(outletId))) &&
  ((!rule.productIds?.length && !rule.categories?.length) ||
    rule.productIds?.includes(product.id) ||
    rule.categories?.includes(product.category)) &&
  isRuleTimeActive(rule, at);

const applyRule = (rule, base) => {
  const value = Number(rule.value);
  if (rule.discountType === "percent_off") return roundMoney(base * (1 - Math.min(100, Math.max(0, value)) / 100));
  if (rule.discountType === "amount_off") return roundMoney(Math.max(0, base - value));
  if (rule.discountType === "fixed_price") return roundMoney(Math.max(0, value));
  return base;
};

// ---------------------------------------------------------------------------------------------------- base price

const channelSetting = (product, channel) => {
  const settings = product.channelSettings && typeof product.channelSettings === "object" ? product.channelSettings : {};
  return settings[channel] || null;
};

/** Whether the product can be sold at this outlet on this channel. */
export const availability = (product, { outletLink, channel }) => {
  if (product.active === false) return { available: false, reason: "PRODUCT_INACTIVE" };
  if (outletLink && outletLink.enabled === false) return { available: false, reason: "PRODUCT_NOT_AT_OUTLET" };
  if (channel && channelSetting(product, channel)?.active === false) return { available: false, reason: "PRODUCT_NOT_ON_CHANNEL" };
  return { available: true };
};

/** Price before any time-based rule: outlet override, else channel price, else the product price. */
export const listPrice = (product, { outletLink, channel }) => {
  if (outletLink && outletLink.priceOverride !== null && outletLink.priceOverride !== undefined) {
    return roundMoney(outletLink.priceOverride);
  }
  const channelPrice = channel ? Number(channelSetting(product, channel)?.price) : Number.NaN;
  if (Number.isFinite(channelPrice) && channelPrice >= 0) return roundMoney(channelPrice);
  return roundMoney(product.price || 0);
};

/** Base price after the best (lowest-price) matching rule. */
export const effectiveBase = (product, { outletLink, channel, salesChannel, outletId, at, rules = [] }) => {
  const list = listPrice(product, { outletLink, channel });
  let best = { price: list, rule: null };
  for (const rule of rules) {
    if (!ruleAppliesTo(rule, { product, outletId, salesChannel: salesChannel || channel, at })) continue;
    const price = applyRule(rule, list);
    if (price < best.price) best = { price, rule };
  }
  return { listPrice: list, price: best.price, rule: best.rule };
};

// ---------------------------------------------------------------------------------------------------- selections

const optionKey = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return { id: value, name: value.trim() };
  return { id: value.id ?? value.option_id ?? null, name: String(value.name ?? "").trim() };
};

const findByIdOrName = (options, wanted) => {
  const key = optionKey(wanted);
  if (!key) return null;
  return options.find((option) => (key.id && option.id === key.id) || (key.name && option.name === key.name)) || null;
};

const selectedModifierIds = (item) => {
  const raw = item.modifier_option_ids ?? item.modifierOptionIds ?? item.modifiers;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (typeof entry === "string" ? entry : entry?.option_id ?? entry?.id ?? null))
    .filter(Boolean)
    .map(String);
};

/**
 * Validate and price the chosen modifier options against the product's groups, enforcing each group's
 * minimum and maximum. Returns the chosen options with their charged prices.
 */
export const resolveModifiers = (product, item) => {
  const groups = product.modifierGroups || [];
  const wanted = selectedModifierIds(item);
  if (!groups.length) {
    if (wanted.length) throw bad("UNKNOWN_MODIFIER", `${product.name} has no choices to make`);
    return [];
  }
  const byId = new Map();
  groups.forEach((group) => (group.options || []).forEach((option) => byId.set(option.id, { group, option })));
  const chosen = [];
  const seen = new Set();
  for (const id of wanted) {
    const match = byId.get(id);
    if (!match || match.option.active === false) throw bad("UNKNOWN_MODIFIER", `A selected choice is not available for ${product.name}`);
    if (seen.has(id)) continue;
    seen.add(id);
    chosen.push(match);
  }
  for (const group of groups) {
    const count = chosen.filter((entry) => entry.group.id === group.id).length;
    const min = Math.max(0, Number(group.minSelect || 0));
    const max = Math.max(min, Number(group.maxSelect ?? 1));
    if (count < min) throw bad("MODIFIER_REQUIRED", `Choose ${min === 1 ? "one" : `at least ${min}`} for "${group.name}" (${product.name})`);
    if (max > 0 && count > max) throw bad("TOO_MANY_MODIFIERS", `Choose at most ${max} for "${group.name}" (${product.name})`);
  }
  return chosen.map(({ group, option }) => ({
    group_id: group.id,
    group_name: group.name,
    option_id: option.id,
    name: option.name,
    price: roundMoney(option.price || 0),
    linked_product_id: option.linkedProductId || null,
  }));
};

/**
 * Price one line for sale. `product` must include variations, addons, modifierGroups.options and
 * comboComponents.component; `outletLink` is the product's OutletProduct row for the sale's outlet (if any).
 */
export const priceLine = ({ product, item, quantity, outletLink, channel, salesChannel, outletId, at, rules }) => {
  const state = availability(product, { outletLink, channel });
  if (!state.available) {
    const messages = {
      PRODUCT_INACTIVE: `${product.name} is not available`,
      PRODUCT_NOT_AT_OUTLET: `${product.name} is not sold at this outlet`,
      PRODUCT_NOT_ON_CHANNEL: `${product.name} is not available for ${channel}`,
    };
    throw bad(state.reason, messages[state.reason]);
  }

  let variationPrice = 0;
  let variationName = null;
  if (item.variation !== undefined && item.variation !== null && item.variation !== "") {
    const variation = findByIdOrName(product.variations || [], item.variation);
    if (!variation) throw bad("UNKNOWN_VARIATION", `Unknown variation for ${product.name}`);
    variationPrice = Number(variation.price || 0);
    variationName = variation.name;
  }

  let addonPrice = 0;
  const seenAddons = new Set();
  for (const input of Array.isArray(item.addons) ? item.addons : []) {
    const addon = findByIdOrName(product.addons || [], input);
    if (!addon) throw bad("UNKNOWN_ADDON", `Unknown add-on for ${product.name}`);
    if (seenAddons.has(addon.id)) continue;
    seenAddons.add(addon.id);
    addonPrice += Number(addon.price || 0);
  }

  const options = resolveModifiers(product, item);
  const optionsPrice = options.reduce((sum, option) => sum + option.price, 0);
  const base = effectiveBase(product, { outletLink, channel, salesChannel, outletId, at, rules });
  const comboComponents = product.isCombo
    ? (product.comboComponents || []).map((component) => ({
        product_id: component.componentProductId,
        name: component.component?.name || null,
        quantity: component.quantity,
      }))
    : [];

  const hasDetail = options.length || comboComponents.length || base.rule;
  return {
    ...item,
    productId: product.id,
    quantity,
    price: roundMoney(base.price + variationPrice + addonPrice + optionsPrice),
    variation: variationName ?? item.variation ?? null,
    // Kitchen and receipts show what was actually chosen, not a client-supplied label.
    ...(options.length || comboComponents.length
      ? { name: [product.name, variationName, options.length ? `(${options.map((option) => option.name).join(", ")})` : null].filter(Boolean).join(" ") }
      : {}),
    modifiers: hasDetail
      ? {
          options,
          combo_components: comboComponents,
          price_rule: base.rule
            ? { id: base.rule.id, name: base.rule.name, list_price: base.listPrice, discounted_price: base.price }
            : null,
        }
      : null,
  };
};

/** The Prisma include every pricing call needs. */
export const pricingInclude = (outletId) => ({
  variations: true,
  addons: true,
  modifierGroups: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
  comboComponents: { include: { component: { select: { id: true, name: true } } } },
  outletLinks: outletId ? { where: { outletId } } : false,
});

export const loadActiveRules = (client, businessId) =>
  client.priceRule.findMany({ where: { businessId, active: true } });
