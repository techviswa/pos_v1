import prisma from "../../database/prisma/client.js";
import { assertOwnedIds } from "../../database/prisma/scope.js";
import { createHttpError, createNotFoundError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";
import { DISCOUNT_TYPES, isRuleTimeActive, isValidTimeZone, RULE_CHANNELS } from "./menu-pricing.js";

const bad = (code, message) => createHttpError({ statusCode: 400, code, message });

/** Accepts minutes (0-1439) or "HH:MM". */
const parseMinute = (value, label) => {
  if (typeof value === "string" && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    const [hours, minutes] = value.trim().split(":").map(Number);
    if (hours < 24 && minutes < 60) return hours * 60 + minutes;
  }
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0 && number < 1440) return number;
  throw bad("INVALID_TIME", `${label} must be a time like 17:00`);
};

const toTime = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const stringList = (value) => [...new Set((Array.isArray(value) ? value : []).map((entry) => String(entry).trim()).filter(Boolean))];

const serializeRule = (rule, at = new Date()) => ({
  id: rule.id,
  name: rule.name,
  active: rule.active,
  discount_type: rule.discountType,
  value: rule.value,
  days_of_week: rule.daysOfWeek,
  start_time: toTime(rule.startMinute),
  end_time: toTime(rule.endMinute),
  timezone: rule.timezone,
  channels: rule.channels,
  outlet_ids: rule.outletIds,
  product_ids: rule.productIds,
  categories: rule.categories,
  valid_from: rule.validFrom ? rule.validFrom.toISOString() : null,
  valid_to: rule.validTo ? rule.validTo.toISOString() : null,
  running_now: rule.active && isRuleTimeActive(rule, at),
  created_at: rule.createdAt?.toISOString() || null,
  updated_at: rule.updatedAt?.toISOString() || null,
});

const parseDate = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw bad("INVALID_DATE", `${label} is not a valid date`);
  return date;
};

class PriceRulesService {
  async validate({ businessId, payload, current = null }) {
    const pick = (key, fallback) => (payload[key] !== undefined ? payload[key] : fallback);
    const name = String(pick("name", current?.name) || "").trim();
    if (!name || name.length > 80) throw bad("RULE_NAME_REQUIRED", "Give the rule a name (up to 80 characters)");

    const discountType = pick("discount_type", current?.discountType);
    if (!DISCOUNT_TYPES.includes(discountType)) throw bad("INVALID_DISCOUNT_TYPE", `discount_type must be one of: ${DISCOUNT_TYPES.join(", ")}`);
    const value = Number(pick("value", current?.value));
    if (!Number.isFinite(value) || value < 0 || (discountType === "percent_off" && (value <= 0 || value > 100)) || value > 1_000_000) {
      throw bad("INVALID_VALUE", discountType === "percent_off" ? "Percent off must be more than 0 and at most 100" : "Value must be 0 or more");
    }

    const days = pick("days_of_week", current?.daysOfWeek) || [];
    if (!Array.isArray(days) || days.some((day) => !Number.isInteger(Number(day)) || Number(day) < 0 || Number(day) > 6)) {
      throw bad("INVALID_DAYS", "days_of_week must contain numbers 0 (Sunday) to 6 (Saturday)");
    }
    const startMinute = parseMinute(pick("start_time", current ? toTime(current.startMinute) : undefined), "Start time");
    const endMinute = parseMinute(pick("end_time", current ? toTime(current.endMinute) : undefined), "End time");

    const timezone = String(pick("timezone", current?.timezone || "Asia/Kolkata"));
    if (!isValidTimeZone(timezone)) throw bad("INVALID_TIMEZONE", "Unknown time zone");

    const channels = stringList(pick("channels", current?.channels));
    const unknownChannel = channels.find((channel) => !RULE_CHANNELS.includes(channel));
    if (unknownChannel) throw bad("INVALID_CHANNEL", `Unknown channel "${unknownChannel}"; use ${RULE_CHANNELS.join(", ")}`);

    const outletIds = stringList(pick("outlet_ids", current?.outletIds));
    const productIds = stringList(pick("product_ids", current?.productIds));
    await assertOwnedIds({ kind: "outlet", ids: outletIds, businessId });
    await assertOwnedIds({ kind: "product", ids: productIds, businessId });

    const validFrom = parseDate(pick("valid_from", current?.validFrom), "Start date");
    const validTo = parseDate(pick("valid_to", current?.validTo), "End date");
    if (validFrom && validTo && validTo <= validFrom) throw bad("INVALID_DATE", "End date must be after the start date");

    return {
      name,
      active: pick("active", current?.active ?? true) !== false,
      discountType,
      value,
      daysOfWeek: [...new Set(days.map(Number))].sort(),
      startMinute,
      endMinute,
      timezone,
      channels,
      outletIds,
      productIds,
      categories: stringList(pick("categories", current?.categories)),
      validFrom,
      validTo,
    };
  }

  async list({ businessId }) {
    const rules = await prisma.priceRule.findMany({ where: { businessId }, orderBy: { createdAt: "asc" } });
    const at = new Date();
    return rules.map((rule) => serializeRule(rule, at));
  }

  async create({ businessId, tenantId, payload }) {
    const data = await this.validate({ businessId, payload });
    const rule = await prisma.priceRule.create({ data: { ...data, businessId } });
    await admincoreChangeSyncService.notifyChange({ resource: "products", action: "price_rule_created", recordId: rule.id, tenantId, businessId });
    return serializeRule(rule);
  }

  async update({ businessId, tenantId, ruleId, payload }) {
    const current = await prisma.priceRule.findFirst({ where: { id: ruleId, businessId } });
    if (!current) throw createNotFoundError("Price rule", { ruleId });
    const data = await this.validate({ businessId, payload, current });
    const rule = await prisma.priceRule.update({ where: { id: current.id }, data });
    await admincoreChangeSyncService.notifyChange({ resource: "products", action: "price_rule_updated", recordId: rule.id, tenantId, businessId });
    return serializeRule(rule);
  }

  async remove({ businessId, tenantId, ruleId }) {
    const deleted = await prisma.priceRule.deleteMany({ where: { id: ruleId, businessId } });
    if (!deleted.count) throw createNotFoundError("Price rule", { ruleId });
    await admincoreChangeSyncService.notifyChange({ resource: "products", action: "price_rule_deleted", recordId: ruleId, tenantId, businessId });
    return { id: ruleId, deleted: true };
  }
}

export const priceRulesService = new PriceRulesService();
