import { randomBytes } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { getCustomerSettings, normalizePhone } from "../customers/customer-core.js";
import { encryptSecret, sendSms, sendWhatsApp, smsCredentials } from "./providers.js";

/**
 * Promotional WhatsApp and SMS.
 *
 * Only customers who agreed to receive offers are ever messaged, and replying STOP withdraws that. Messages go out
 * only inside the business's sending window (TRAI allows promotional SMS 10:00-21:00) and at most `weeklyCap` per
 * person per 7 days across all campaigns. WhatsApp business-initiated messages must use templates approved by Meta;
 * SMS in India must use DLT-registered templates, so both are referenced here rather than free text.
 */
const fail = (statusCode, code, message) => { throw createHttpError({ statusCode, code, message }); };
export const CHANNELS = ["whatsapp", "sms"];
export const KINDS = ["one_time", "birthday", "anniversary", "winback"];
export const FIELDS = {
  first_name: "First name",
  name: "Full name",
  points: "Loyalty points",
  points_value: "Points value (₹)",
  visits: "Number of visits",
  last_visit: "Last visit date",
  business_name: "Business name",
};
const MAX_RECIPIENTS = 50000;
const TEST_SENDS_PER_HOUR = 20;
const testSends = new Map();

// ---------------------------------------------------------------- settings
const newKey = () => randomBytes(24).toString("base64url");

export const loadConfig = async (businessId, client = prisma) => {
  const existing = await client.marketingConfig.findUnique({ where: { businessId } });
  if (existing) return existing;
  return client.marketingConfig.upsert({ where: { businessId }, update: {}, create: { businessId, smsWebhookKey: newKey(), whatsappVerifyToken: newKey() } });
};

const publicBase = () => String(process.env.POS_PUBLIC_API_URL || process.env.POS_BASE_URL || "").replace(/\/+$/, "");
export const webhookUrls = (config) => {
  const base = publicBase() || "https://YOUR-POS-API";
  return {
    whatsapp_webhook: `${base}/api/public/marketing/whatsapp/webhook`,
    sms_status: `${base}/api/public/marketing/sms/status/${config.smsWebhookKey}`,
    sms_inbound: `${base}/api/public/marketing/sms/inbound/${config.smsWebhookKey}`,
  };
};

const serializeConfig = (config) => {
  const sms = smsCredentials(config);
  return {
    whatsapp_enabled: config.whatsappEnabled,
    whatsapp_phone_number_id: config.whatsappPhoneNumberId,
    whatsapp_business_account_id: config.whatsappBusinessAccountId,
    whatsapp_access_token_set: Boolean(config.whatsappAccessTokenEnc),
    whatsapp_app_secret_set: Boolean(config.whatsappAppSecretEnc),
    whatsapp_verify_token: config.whatsappVerifyToken,
    sms_enabled: config.smsEnabled,
    sms_provider: config.smsProvider,
    sms_sender_id: config.smsSenderId,
    sms_dlt_entity_id: config.smsDltEntityId,
    // Which secrets are stored, never their values.
    sms_credentials_set: Object.fromEntries(Object.entries(sms).map(([key, value]) => [key, key === "from" || key === "url" || key === "account_sid" || key === "messaging_service_sid" ? value : Boolean(value)])),
    send_window_start: config.sendWindowStart,
    send_window_end: config.sendWindowEnd,
    utc_offset_minutes: config.utcOffsetMinutes,
    weekly_cap: config.weeklyCap,
    whatsapp_cost_per_message: Number(config.whatsappCostPerMessage),
    sms_cost_per_message: Number(config.smsCostPerMessage),
    webhooks: webhookUrls(config),
  };
};

const intIn = (value, min, max, field) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(400, "MARKETING_INVALID", `${field} must be a whole number between ${min} and ${max}`);
  return number;
};
const clean = (value, max = 120) => (value === undefined ? undefined : value === null || value === "" ? null : String(value).trim().slice(0, max));

// ---------------------------------------------------------------- templates
const placeholderCount = (channel, body) => (channel === "whatsapp"
  ? new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]))).size
  : (body.match(/\{#var#\}/gi) || []).length);

const validateTemplate = (payload, existing = {}) => {
  const channel = payload.channel ?? existing.channel;
  if (!CHANNELS.includes(channel)) fail(400, "MARKETING_INVALID", "Channel must be whatsapp or sms");
  const name = clean(payload.name ?? existing.name, 80);
  if (!name) fail(400, "MARKETING_INVALID", "Give the template a name");
  const body = String(payload.body ?? existing.body ?? "").trim();
  if (!body || body.length > 1024) fail(400, "MARKETING_INVALID", "Message text is required (at most 1024 characters)");
  const variables = payload.variables ?? existing.variables ?? [];
  if (!Array.isArray(variables) || variables.length > 10) fail(400, "MARKETING_INVALID", "At most 10 placeholders");
  const normalizedVariables = variables.map((row, index) => {
    if (row?.source === "field" && Object.hasOwn(FIELDS, row.value)) return { source: "field", value: row.value };
    if (row?.source === "text" && String(row.value || "").trim()) return { source: "text", value: String(row.value).trim().slice(0, 60) };
    return fail(400, "MARKETING_INVALID", `Placeholder ${index + 1} needs a customer field or a fixed text`);
  });
  const count = placeholderCount(channel, body);
  if (channel === "whatsapp") {
    const numbers = [...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
    if (numbers.some((number, index) => number !== index + 1)) fail(400, "MARKETING_INVALID", "WhatsApp placeholders must be {{1}}, {{2}}, ... in order");
  }
  if (count !== normalizedVariables.length) fail(400, "MARKETING_INVALID", `The text has ${count} placeholder(s) but ${normalizedVariables.length} value(s) are set`);
  const data = {
    channel, name, body, variables: normalizedVariables,
    whatsappTemplateName: channel === "whatsapp" ? clean(payload.whatsapp_template_name ?? existing.whatsappTemplateName, 512) : null,
    language: channel === "whatsapp" ? clean(payload.language ?? existing.language ?? "en", 15) : null,
    dltTemplateId: channel === "sms" ? clean(payload.dlt_template_id ?? existing.dltTemplateId, 40) : null,
    providerTemplateId: channel === "sms" ? clean(payload.provider_template_id ?? existing.providerTemplateId, 80) : null,
  };
  if (channel === "whatsapp" && !/^[a-z0-9_]{1,512}$/.test(data.whatsappTemplateName || "")) fail(400, "MARKETING_INVALID", "Enter the approved WhatsApp template name (lowercase letters, digits and _)");
  if (channel === "sms" && !/^\d{10,25}$/.test(data.dltTemplateId || "")) fail(400, "MARKETING_INVALID", "Enter the DLT template id (digits) registered for this text");
  return data;
};

const serializeTemplate = (template) => ({
  id: template.id, channel: template.channel, name: template.name, body: template.body, variables: template.variables,
  whatsapp_template_name: template.whatsappTemplateName, language: template.language, dlt_template_id: template.dltTemplateId,
  provider_template_id: template.providerTemplateId, created_at: template.createdAt.toISOString(),
});

// ---------------------------------------------------------------- rendering
const localDate = (date, offsetMinutes) => new Date(date.getTime() + offsetMinutes * 60000).toISOString().slice(0, 10);

export const fieldValues = (customer, { businessName, pointValue, offsetMinutes }) => ({
  first_name: String(customer.name || "").trim().split(/\s+/)[0] || "there",
  name: customer.name || "there",
  points: String(customer.loyaltyPoints ?? 0),
  points_value: String(Math.round((customer.loyaltyPoints || 0) * pointValue * 100) / 100),
  visits: String(customer.visitCount ?? 0),
  last_visit: customer.lastVisitAt ? localDate(customer.lastVisitAt, offsetMinutes) : "-",
  business_name: businessName || "",
});

/** Values for the placeholders, in order, plus the text as the guest will read it. */
export const renderTemplate = (template, values) => {
  // DLT variables are limited to 30 characters; WhatsApp parameters must not contain new lines or long spaces.
  const limit = template.channel === "sms" ? 30 : 200;
  const parameters = (template.variables || []).map((row) => String(row.source === "field" ? values[row.value] ?? "" : row.value)
    .replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, limit) || "-");
  let index = 0;
  const text = template.channel === "whatsapp"
    ? template.body.replace(/\{\{(\d+)\}\}/g, (_, number) => parameters[Number(number) - 1] ?? "")
    : template.body.replace(/\{#var#\}/gi, () => parameters[index++] ?? "");
  return { parameters, text };
};

// ---------------------------------------------------------------- audiences
const numberOrNull = (value) => (value === undefined || value === null || value === "" ? null : Number(value));
export const normalizeAudience = (audience = {}) => {
  const tags = Array.isArray(audience.tags) ? audience.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 10) : [];
  const out = { tags };
  for (const key of ["min_visits", "min_spent", "min_points", "inactive_days", "active_within_days", "winback_days"]) {
    const value = numberOrNull(audience[key]);
    if (value !== null) {
      if (!Number.isFinite(value) || value < 0 || value > 100000000) fail(400, "MARKETING_INVALID", `${key} is not valid`);
      out[key] = value;
    }
  }
  if (audience.birthday_this_month) out.birthday_this_month = true;
  return out;
};

const matchesAudience = (customer, audience, now = new Date()) => {
  if (audience.tags?.length && !audience.tags.some((tag) => customer.tags.includes(tag))) return false;
  if (audience.min_visits !== undefined && customer.visitCount < audience.min_visits) return false;
  if (audience.min_spent !== undefined && Number(customer.totalSpent) < audience.min_spent) return false;
  if (audience.min_points !== undefined && customer.loyaltyPoints < audience.min_points) return false;
  if (audience.inactive_days !== undefined && (!customer.lastVisitAt || now - customer.lastVisitAt < audience.inactive_days * 86400000)) return false;
  if (audience.active_within_days !== undefined && (!customer.lastVisitAt || now - customer.lastVisitAt > audience.active_within_days * 86400000)) return false;
  if (audience.birthday_this_month && (!customer.birthday || customer.birthday.getUTCMonth() !== now.getUTCMonth())) return false;
  return true;
};

const isLeap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
/** Birthdays/anniversaries on this local date (29 February is celebrated on the 28th in other years). */
const onDay = (date, today) => {
  if (!date) return false;
  const [year, month, day] = today.split("-").map(Number);
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  if (m === month && d === day) return true;
  return m === 2 && d === 29 && month === 2 && day === 28 && !isLeap(year);
};

/** Customers who may receive this campaign now: consented, reachable, matching the segment (and the automation's day). */
export const audienceFor = async ({ businessId, campaign, today, offsetMinutes, client = prisma }) => {
  const customers = await client.customer.findMany({ where: { businessId, anonymizedAt: null, marketingOptIn: true } });
  const audience = normalizeAudience(campaign.audience || {});
  const now = new Date();
  return customers.filter((customer) => {
    if (!normalizePhone(customer.phone)) return false;
    if (!matchesAudience(customer, audience, now)) return false;
    if (campaign.kind === "birthday") return onDay(customer.birthday, today);
    if (campaign.kind === "anniversary") return onDay(customer.anniversary, today);
    if (campaign.kind === "winback") {
      const days = audience.winback_days ?? 30;
      return Boolean(customer.lastVisitAt) && localDate(new Date(customer.lastVisitAt.getTime() + days * 86400000), offsetMinutes) === today;
    }
    return true;
  });
};

// ---------------------------------------------------------------- campaigns
const serializeCampaign = (campaign, counts = {}) => ({
  id: campaign.id, name: campaign.name, channel: campaign.channel, kind: campaign.kind, status: campaign.status,
  template_id: campaign.templateId, template_name: campaign.template?.name || null, audience: campaign.audience,
  scheduled_at: campaign.scheduledAt?.toISOString() || null, started_at: campaign.startedAt?.toISOString() || null,
  completed_at: campaign.completedAt?.toISOString() || null, send_hour: campaign.sendHour, last_run_on: campaign.lastRunOn,
  created_by_name: campaign.createdByName, created_at: campaign.createdAt.toISOString(), counts,
});

const countsByCampaign = async (campaignIds) => {
  if (!campaignIds.length) return new Map();
  const rows = await prisma.marketingMessage.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaignIds } }, _count: true });
  const map = new Map();
  for (const row of rows) {
    const counts = map.get(row.campaignId) || {};
    counts[row.status] = row._count;
    map.set(row.campaignId, counts);
  }
  return map;
};

/** Creates the queued messages of a run. Duplicates (same person, same run) are ignored by the database. */
export const materialize = async (tx, { campaign, config, runKey, today }) => {
  const recipients = await audienceFor({ businessId: campaign.businessId, campaign, today, offsetMinutes: config.utcOffsetMinutes, client: tx });
  if (recipients.length > MAX_RECIPIENTS) fail(400, "MARKETING_AUDIENCE_TOO_LARGE", `At most ${MAX_RECIPIENTS} people per send`);
  for (let index = 0; index < recipients.length; index += 1000) {
    await tx.marketingMessage.createMany({
      data: recipients.slice(index, index + 1000).map((customer) => ({
        businessId: campaign.businessId, campaignId: campaign.id, customerId: customer.id, runKey, channel: campaign.channel, phone: customer.phone,
      })),
      skipDuplicates: true,
    });
  }
  return recipients.length;
};

class MarketingService {
  async getConfig({ businessId }) {
    return serializeConfig(await loadConfig(businessId));
  }

  async saveConfig({ businessId, payload = {} }) {
    const current = await loadConfig(businessId);
    const data = {};
    if (payload.whatsapp_enabled !== undefined) data.whatsappEnabled = Boolean(payload.whatsapp_enabled);
    if (payload.whatsapp_phone_number_id !== undefined) {
      const id = clean(payload.whatsapp_phone_number_id, 40);
      if (id && !/^\d{6,30}$/.test(id)) fail(400, "MARKETING_INVALID", "The WhatsApp phone number ID is the long number from Meta's API setup page");
      data.whatsappPhoneNumberId = id;
    }
    if (payload.whatsapp_business_account_id !== undefined) data.whatsappBusinessAccountId = clean(payload.whatsapp_business_account_id, 40);
    // Secrets are only replaced when a new value is typed; an empty field keeps the stored one.
    if (payload.whatsapp_access_token) data.whatsappAccessTokenEnc = encryptSecret(String(payload.whatsapp_access_token).trim());
    if (payload.whatsapp_app_secret) data.whatsappAppSecretEnc = encryptSecret(String(payload.whatsapp_app_secret).trim());
    if (payload.regenerate_verify_token) data.whatsappVerifyToken = newKey();
    if (payload.sms_enabled !== undefined) data.smsEnabled = Boolean(payload.sms_enabled);
    if (payload.sms_provider !== undefined) {
      if (payload.sms_provider && !["twilio", "msg91", "webhook"].includes(payload.sms_provider)) fail(400, "MARKETING_INVALID", "SMS provider must be twilio, msg91 or webhook");
      data.smsProvider = payload.sms_provider || null;
    }
    if (payload.sms_sender_id !== undefined) {
      const sender = clean(payload.sms_sender_id, 11);
      if (sender && !/^[A-Za-z0-9]{3,11}$/.test(sender)) fail(400, "MARKETING_INVALID", "Sender ID (header) is 3-11 letters or digits");
      data.smsSenderId = sender;
    }
    if (payload.sms_dlt_entity_id !== undefined) {
      const entity = clean(payload.sms_dlt_entity_id, 30);
      if (entity && !/^\d{10,25}$/.test(entity)) fail(400, "MARKETING_INVALID", "DLT entity (PE) id is a number");
      data.smsDltEntityId = entity;
    }
    if (payload.sms_credentials && typeof payload.sms_credentials === "object") {
      const merged = { ...smsCredentials(current) };
      for (const key of ["account_sid", "auth_token", "from", "messaging_service_sid", "auth_key", "url", "token"]) {
        if (payload.sms_credentials[key]) merged[key] = String(payload.sms_credentials[key]).trim().slice(0, 300);
      }
      data.smsCredentialsEnc = encryptSecret(JSON.stringify(merged));
    }
    if (payload.regenerate_sms_webhook_key) data.smsWebhookKey = newKey();
    const start = payload.send_window_start !== undefined ? intIn(payload.send_window_start, 0, 1439, "Window start") : current.sendWindowStart;
    const end = payload.send_window_end !== undefined ? intIn(payload.send_window_end, 1, 1440, "Window end") : current.sendWindowEnd;
    if (end <= start) fail(400, "MARKETING_INVALID", "The sending window must end after it starts");
    if (start < 540 || end > 1260) fail(400, "MARKETING_INVALID", "Promotions may only be sent between 09:00 and 21:00");
    Object.assign(data, { sendWindowStart: start, sendWindowEnd: end });
    if (payload.utc_offset_minutes !== undefined) data.utcOffsetMinutes = intIn(payload.utc_offset_minutes, -720, 840, "Timezone offset");
    if (payload.weekly_cap !== undefined) data.weeklyCap = intIn(payload.weekly_cap, 1, 14, "Messages per person per week");
    for (const [key, field] of [["whatsapp_cost_per_message", "whatsappCostPerMessage"], ["sms_cost_per_message", "smsCostPerMessage"]]) {
      if (payload[key] !== undefined) {
        const value = Number(payload[key]);
        if (!Number.isFinite(value) || value < 0 || value > 100) fail(400, "MARKETING_INVALID", "Cost per message must be between 0 and 100");
        data[field] = value;
      }
    }
    const next = { ...current, ...data };
    if (next.whatsappEnabled && (!next.whatsappPhoneNumberId || !next.whatsappAccessTokenEnc || !next.whatsappAppSecretEnc)) {
      fail(400, "MARKETING_INVALID", "To switch WhatsApp on, enter the phone number ID, access token and app secret");
    }
    if (next.smsEnabled && !next.smsProvider) fail(400, "MARKETING_INVALID", "Choose an SMS provider to switch SMS on");
    try {
      return serializeConfig(await prisma.marketingConfig.update({ where: { businessId }, data }));
    } catch (error) {
      if (error.code === "P2002") fail(409, "MARKETING_INVALID", "This WhatsApp number is already connected to another business");
      throw error;
    }
  }

  async listTemplates({ businessId }) {
    return (await prisma.marketingTemplate.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } })).map(serializeTemplate);
  }

  async createTemplate({ businessId, payload }) {
    return serializeTemplate(await prisma.marketingTemplate.create({ data: { businessId, ...validateTemplate(payload) } }));
  }

  async updateTemplate({ businessId, templateId, payload }) {
    const existing = await prisma.marketingTemplate.findFirst({ where: { id: String(templateId), businessId } });
    if (!existing) fail(404, "TEMPLATE_NOT_FOUND", "Template not found");
    const inUse = await prisma.marketingCampaign.count({ where: { templateId: existing.id, status: { in: ["scheduled", "sending", "active"] } } });
    if (inUse) fail(409, "TEMPLATE_IN_USE", "Pause or finish the campaigns using this template before changing it");
    return serializeTemplate(await prisma.marketingTemplate.update({ where: { id: existing.id }, data: validateTemplate(payload, existing) }));
  }

  async deleteTemplate({ businessId, templateId }) {
    const existing = await prisma.marketingTemplate.findFirst({ where: { id: String(templateId), businessId } });
    if (!existing) fail(404, "TEMPLATE_NOT_FOUND", "Template not found");
    if (await prisma.marketingCampaign.count({ where: { templateId: existing.id } })) fail(409, "TEMPLATE_IN_USE", "Campaigns use this template; it is kept for their history");
    await prisma.marketingTemplate.delete({ where: { id: existing.id } });
    return { deleted: true };
  }

  /** How many people a campaign would reach now, what one message looks like, and the estimated cost. */
  async preview({ businessId, payload = {} }) {
    const template = await prisma.marketingTemplate.findFirst({ where: { id: String(payload.template_id || ""), businessId } });
    if (!template) fail(404, "TEMPLATE_NOT_FOUND", "Choose a template");
    const config = await loadConfig(businessId);
    const kind = KINDS.includes(payload.kind) ? payload.kind : "one_time";
    const today = localDate(new Date(), config.utcOffsetMinutes);
    const recipients = await audienceFor({ businessId, campaign: { kind, audience: normalizeAudience(payload.audience) }, today, offsetMinutes: config.utcOffsetMinutes });
    const [business, settings] = await Promise.all([prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }), getCustomerSettings(businessId)]);
    const sample = recipients[0] || { name: "Asha Rao", loyaltyPoints: 120, visitCount: 4, lastVisitAt: new Date() };
    const rendered = renderTemplate(template, fieldValues(sample, { businessName: business?.name, pointValue: settings.loyalty.point_value, offsetMinutes: config.utcOffsetMinutes }));
    const optedIn = await prisma.customer.count({ where: { businessId, anonymizedAt: null, marketingOptIn: true } });
    const cost = Number(template.channel === "whatsapp" ? config.whatsappCostPerMessage : config.smsCostPerMessage);
    return {
      recipients: recipients.length,
      opted_in_customers: optedIn,
      sample_text: rendered.text,
      sms_segments: template.channel === "sms" ? Math.ceil(rendered.text.length / (/[^\x00-\x7F]/.test(rendered.text) ? 67 : 153)) || 1 : null,
      estimated_cost: Math.round(recipients.length * cost * 100) / 100,
      today_only: kind !== "one_time",
    };
  }

  async listCampaigns({ businessId }) {
    const campaigns = await prisma.marketingCampaign.findMany({ where: { businessId }, include: { template: true }, orderBy: { createdAt: "desc" }, take: 200 });
    const counts = await countsByCampaign(campaigns.map((campaign) => campaign.id));
    return campaigns.map((campaign) => serializeCampaign(campaign, counts.get(campaign.id) || {}));
  }

  async createCampaign({ businessId, actor, payload = {} }) {
    const name = clean(payload.name, 100);
    if (!name) fail(400, "MARKETING_INVALID", "Give the campaign a name");
    const kind = KINDS.includes(payload.kind) ? payload.kind : "one_time";
    const template = await prisma.marketingTemplate.findFirst({ where: { id: String(payload.template_id || ""), businessId } });
    if (!template) fail(404, "TEMPLATE_NOT_FOUND", "Choose a template");
    const data = {
      businessId, name, kind, channel: template.channel, templateId: template.id, audience: normalizeAudience(payload.audience),
      createdById: actor?.id || null, createdByName: actor?.name || null,
    };
    if (kind === "one_time") {
      data.status = "draft";
    } else {
      data.status = "paused";
      data.sendHour = payload.send_hour === undefined ? 11 : intIn(payload.send_hour, 0, 23, "Send hour");
    }
    const campaign = await prisma.marketingCampaign.create({ data, include: { template: true } });
    return serializeCampaign(campaign);
  }

  async loadCampaign(client, businessId, campaignId) {
    const campaign = await client.marketingCampaign.findFirst({ where: { id: String(campaignId), businessId }, include: { template: true } });
    if (!campaign) fail(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
    return campaign;
  }

  assertChannelReady(config, channel) {
    if (channel === "whatsapp" && !config.whatsappEnabled) fail(409, "CHANNEL_NOT_CONNECTED", "Connect and switch on WhatsApp in Marketing settings first");
    if (channel === "sms" && !config.smsEnabled) fail(409, "CHANNEL_NOT_CONNECTED", "Connect and switch on SMS in Marketing settings first");
  }

  /** Send a one-time campaign now or at a time; the recipients are fixed when it starts. */
  async schedule({ businessId, campaignId, payload = {} }) {
    const config = await loadConfig(businessId);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`campaign:${campaignId}`}))`;
      const campaign = await this.loadCampaign(tx, businessId, campaignId);
      if (campaign.kind !== "one_time") fail(409, "CAMPAIGN_INVALID", "Automations are switched on, not scheduled");
      if (!["draft", "scheduled"].includes(campaign.status)) fail(409, "CAMPAIGN_INVALID", `This campaign is ${campaign.status}`);
      this.assertChannelReady(config, campaign.channel);
      const at = payload.send_at ? new Date(payload.send_at) : new Date();
      if (Number.isNaN(at.getTime())) fail(400, "MARKETING_INVALID", "Choose a valid send time");
      if (at > new Date(Date.now() + 90 * 86400000)) fail(400, "MARKETING_INVALID", "Schedule at most 90 days ahead");
      if (at <= new Date(Date.now() + 30000)) {
        const count = await materialize(tx, { campaign, config, runKey: "once", today: localDate(new Date(), config.utcOffsetMinutes) });
        if (!count) fail(400, "MARKETING_AUDIENCE_EMPTY", "Nobody who agreed to receive offers matches this audience");
        const updated = await tx.marketingCampaign.update({ where: { id: campaign.id }, data: { status: "sending", scheduledAt: new Date(), startedAt: new Date() }, include: { template: true } });
        return serializeCampaign(updated, { queued: count });
      }
      const updated = await tx.marketingCampaign.update({ where: { id: campaign.id }, data: { status: "scheduled", scheduledAt: at }, include: { template: true } });
      return serializeCampaign(updated);
    }, { timeout: 120000 });
  }

  async cancel({ businessId, campaignId }) {
    return prisma.$transaction(async (tx) => {
      const campaign = await this.loadCampaign(tx, businessId, campaignId);
      if (!["draft", "scheduled", "sending"].includes(campaign.status)) fail(409, "CAMPAIGN_INVALID", `This campaign is ${campaign.status}`);
      await tx.marketingMessage.updateMany({ where: { campaignId: campaign.id, status: "queued" }, data: { status: "skipped", skipReason: "cancelled" } });
      const updated = await tx.marketingCampaign.update({ where: { id: campaign.id }, data: { status: "cancelled", completedAt: new Date() }, include: { template: true } });
      return serializeCampaign(updated);
    });
  }

  async setAutomation({ businessId, campaignId, payload = {} }) {
    const config = await loadConfig(businessId);
    const campaign = await this.loadCampaign(prisma, businessId, campaignId);
    if (campaign.kind === "one_time") fail(409, "CAMPAIGN_INVALID", "Only automations can be switched on or off");
    const active = Boolean(payload.active);
    if (active) this.assertChannelReady(config, campaign.channel);
    const data = { status: active ? "active" : "paused" };
    if (payload.send_hour !== undefined) data.sendHour = intIn(payload.send_hour, 0, 23, "Send hour");
    if (payload.audience !== undefined) data.audience = normalizeAudience(payload.audience);
    const updated = await prisma.marketingCampaign.update({ where: { id: campaign.id }, data, include: { template: true } });
    return serializeCampaign(updated);
  }

  /** Delivery figures and what recipients spent in the 7 days after their message. */
  async report({ businessId, campaignId }) {
    const campaign = await this.loadCampaign(prisma, businessId, campaignId);
    const config = await loadConfig(businessId);
    const messages = await prisma.marketingMessage.findMany({ where: { campaignId: campaign.id }, include: { customer: { select: { name: true } } }, orderBy: { createdAt: "desc" } });
    const counts = {};
    for (const message of messages) counts[message.status] = (counts[message.status] || 0) + 1;
    const reached = messages.filter((message) => ["sent", "delivered", "read"].includes(message.status) && message.sentAt);
    const since = reached.length ? new Date(Math.min(...reached.map((message) => message.sentAt.getTime()))) : null;
    let visits = 0;
    let revenue = 0;
    const returned = new Set();
    if (since) {
      const bills = await prisma.bill.findMany({ where: { businessId, createdAt: { gte: since }, status: { not: "void" } }, select: { total: true, createdAt: true, metadata: true } });
      const sentAtByCustomer = new Map(reached.map((message) => [message.customerId, message.sentAt]));
      for (const bill of bills) {
        const sentAt = sentAtByCustomer.get(bill.metadata?.customer_id);
        if (!sentAt || bill.createdAt < sentAt || bill.createdAt - sentAt > 7 * 86400000) continue;
        visits += 1;
        revenue += Number(bill.total) - Number(bill.metadata?.refunded_amount || 0);
        returned.add(bill.metadata.customer_id);
      }
    }
    const cost = Number(campaign.channel === "whatsapp" ? config.whatsappCostPerMessage : config.smsCostPerMessage);
    return {
      ...serializeCampaign(campaign, counts),
      estimated_cost: Math.round(reached.length * cost * 100) / 100,
      attribution: { customers_returned: returned.size, visits, revenue: Math.round(revenue * 100) / 100, window_days: 7 },
      messages: messages.slice(0, 500).map((message) => ({
        id: message.id, customer_name: message.customer?.name || null, phone: `******${message.phone.slice(-4)}`, run: message.runKey,
        status: message.status, skip_reason: message.skipReason, error: message.error, sent_at: message.sentAt?.toISOString() || null,
        delivered_at: message.deliveredAt?.toISOString() || null, read_at: message.readAt?.toISOString() || null,
      })),
    };
  }

  /** Send one message to a staff member's own phone to check the template and account. No consent or window rules. */
  async testSend({ businessId, payload = {} }) {
    const hour = Math.floor(Date.now() / 3600000);
    const key = `${businessId}:${hour}`;
    const used = testSends.get(key) || 0;
    if (used >= TEST_SENDS_PER_HOUR) fail(429, "TEST_LIMIT", "Too many test messages this hour");
    const phone = normalizePhone(payload.phone);
    if (!phone) fail(400, "PHONE_INVALID", "Enter a valid phone number");
    const template = await prisma.marketingTemplate.findFirst({ where: { id: String(payload.template_id || ""), businessId } });
    if (!template) fail(404, "TEMPLATE_NOT_FOUND", "Choose a template");
    const config = await loadConfig(businessId);
    this.assertChannelReady(config, template.channel);
    testSends.set(key, used + 1);
    const [business, settings, customer] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
      getCustomerSettings(businessId),
      prisma.customer.findUnique({ where: { businessId_phone: { businessId, phone } } }),
    ]);
    const rendered = renderTemplate(template, fieldValues(customer || { name: "Test", loyaltyPoints: 100, visitCount: 3, lastVisitAt: new Date() },
      { businessName: business?.name, pointValue: settings.loyalty.point_value, offsetMinutes: config.utcOffsetMinutes }));
    const result = template.channel === "whatsapp"
      ? await sendWhatsApp({ config, template, to: phone, parameters: rendered.parameters })
      : await sendSms({ config, template, to: phone, text: rendered.text, parameters: rendered.parameters });
    if (!result.ok) fail(502, "TEST_SEND_FAILED", result.error);
    return { sent: true, text: rendered.text, provider_message_id: result.providerMessageId };
  }

  async overview({ businessId }) {
    const [optedIn, optedOut, config] = await Promise.all([
      prisma.customer.count({ where: { businessId, anonymizedAt: null, marketingOptIn: true } }),
      prisma.customer.count({ where: { businessId, anonymizedAt: null, marketingOptOutAt: { not: null }, marketingOptIn: false } }),
      loadConfig(businessId),
    ]);
    const since = new Date(Date.now() - 30 * 86400000);
    const sent = await prisma.marketingMessage.groupBy({ by: ["channel"], where: { businessId, sentAt: { gte: since }, status: { in: ["sent", "delivered", "read"] } }, _count: true });
    return {
      opted_in: optedIn,
      opted_out: optedOut,
      whatsapp_connected: config.whatsappEnabled,
      sms_connected: config.smsEnabled,
      sent_last_30_days: Object.fromEntries(sent.map((row) => [row.channel, row._count])),
      fields: FIELDS,
    };
  }
}

export const marketingService = new MarketingService();
