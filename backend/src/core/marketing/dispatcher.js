import prisma from "../../database/prisma/client.js";
import { logger } from "../../shared/utils/logger.js";
import { getCustomerSettings } from "../customers/customer-core.js";
import { fieldValues, loadConfig, materialize, renderTemplate, webhookUrls } from "./marketing.service.js";
import { sendSms, sendWhatsApp } from "./providers.js";

/**
 * Sends queued marketing messages and starts scheduled campaigns and daily automations.
 *
 * Safe with several API instances: messages are claimed with FOR UPDATE SKIP LOCKED, and the scheduler runs under a
 * try-lock so only one instance materialises a campaign. Every rule (consent, sending window, weekly limit) is checked
 * again at the moment of sending, because a guest may have replied STOP after the campaign was queued.
 */
const MAX_ATTEMPTS = 5;
const REACHED = ["sending", "sent", "delivered", "read"];
const minutesOfDay = (date, offset) => (((date.getUTCHours() * 60 + date.getUTCMinutes() + offset) % 1440) + 1440) % 1440;
const localDate = (date, offset) => new Date(date.getTime() + offset * 60000).toISOString().slice(0, 10);

export const inSendWindow = (config, now = new Date()) => {
  const minute = minutesOfDay(now, config.utcOffsetMinutes);
  return minute >= config.sendWindowStart && minute < config.sendWindowEnd;
};

/** The next moment the window opens (today if it has not opened yet, otherwise tomorrow). */
export const nextWindowStart = (config, now = new Date()) => {
  const minute = minutesOfDay(now, config.utcOffsetMinutes);
  const wait = minute < config.sendWindowStart ? config.sendWindowStart - minute : 1440 - minute + config.sendWindowStart;
  const next = new Date(now.getTime() + wait * 60000);
  next.setUTCSeconds(0, 0);
  return next;
};

const finish = (id, data) => prisma.marketingMessage.update({ where: { id }, data: { lockedUntil: null, ...data } });

export const processMessage = async (id, now = new Date()) => {
  const message = await prisma.marketingMessage.findUnique({ where: { id }, include: { campaign: { include: { template: true } }, customer: true } });
  if (!message || message.status !== "sending") return null;
  const { campaign, customer } = message;
  if (!["sending", "active"].includes(campaign.status)) return finish(id, { status: "skipped", skipReason: "campaign_stopped" });
  if (customer.anonymizedAt || !customer.marketingOptIn) return finish(id, { status: "skipped", skipReason: "no_consent" });
  const config = await loadConfig(message.businessId);
  if (!inSendWindow(config, now)) {
    // Not a failed attempt: wait for the window.
    return finish(id, { status: "queued", nextAttemptAt: nextWindowStart(config, now), attempts: { decrement: 1 } });
  }

  // Reserve this person's weekly slot under a lock, so two campaigns cannot both use the last one.
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`marketing-customer:${customer.id}`}))`;
    const recent = await tx.marketingMessage.count({ where: {
      customerId: customer.id, id: { not: id }, status: { in: REACHED }, sentAt: { gte: new Date(now.getTime() - 7 * 86400000) },
    } });
    if (recent >= config.weeklyCap) return false;
    await tx.marketingMessage.update({ where: { id }, data: { sentAt: now } });
    return true;
  });
  if (!reserved) return finish(id, { status: "skipped", skipReason: "weekly_limit" });

  const [business, settings] = await Promise.all([
    prisma.business.findUnique({ where: { id: message.businessId }, select: { name: true } }),
    getCustomerSettings(message.businessId),
  ]);
  const template = campaign.template;
  const rendered = renderTemplate(template, fieldValues(customer, { businessName: business?.name, pointValue: settings.loyalty.point_value, offsetMinutes: config.utcOffsetMinutes }));
  const hasPublicUrl = Boolean(process.env.POS_PUBLIC_API_URL || process.env.POS_BASE_URL);
  const result = campaign.channel === "whatsapp"
    ? await sendWhatsApp({ config, template, to: message.phone, parameters: rendered.parameters })
    : await sendSms({ config, template, to: message.phone, text: rendered.text, parameters: rendered.parameters,
      statusCallbackUrl: hasPublicUrl ? webhookUrls(config).sms_status : null });
  if (result.ok) {
    return finish(id, { status: "sent", providerMessageId: result.providerMessageId, body: rendered.text, error: null });
  }
  if (result.retry && message.attempts < MAX_ATTEMPTS) {
    return finish(id, { status: "queued", sentAt: null, error: result.error, nextAttemptAt: new Date(now.getTime() + 60000 * 2 ** message.attempts) });
  }
  return finish(id, { status: "failed", sentAt: null, error: result.error, body: rendered.text });
};

/** Claims and sends up to `limit` due messages. */
export const dispatchBatch = async ({ limit = 25, now = new Date() } = {}) => {
  const claimed = await prisma.$queryRaw`
    UPDATE "MarketingMessage" SET "status" = 'sending', "lockedUntil" = ${new Date(now.getTime() + 120000)},
      "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "MarketingMessage"
      WHERE ("status" = 'queued' AND "nextAttemptAt" <= ${now}) OR ("status" = 'sending' AND "lockedUntil" < ${now})
      ORDER BY "nextAttemptAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  let sent = 0;
  for (const row of claimed) {
    try {
      const result = await processMessage(row.id, now);
      if (result?.status === "sent") sent += 1;
    } catch (error) {
      logger.warn(`Marketing message ${row.id} failed: ${error.message}`);
      await prisma.marketingMessage.update({ where: { id: row.id }, data: { status: "queued", lockedUntil: null, sentAt: null,
        nextAttemptAt: new Date(now.getTime() + 5 * 60000), error: "Internal error; will retry" } }).catch(() => {});
    }
  }
  if (claimed.length) await completeCampaigns();
  return { claimed: claimed.length, sent };
};

export const completeCampaigns = async () => {
  const sending = await prisma.marketingCampaign.findMany({ where: { status: "sending" }, select: { id: true } });
  for (const campaign of sending) {
    const open = await prisma.marketingMessage.count({ where: { campaignId: campaign.id, status: { in: ["queued", "sending"] } } });
    if (!open) await prisma.marketingCampaign.updateMany({ where: { id: campaign.id, status: "sending" }, data: { status: "completed", completedAt: new Date() } });
  }
};

/** Starts due scheduled campaigns and today's automation runs. */
export const runScheduler = async (now = new Date()) => {
  const started = [];
  await prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('marketing-scheduler')) AS locked`;
    if (!locked) return;
    const due = await tx.marketingCampaign.findMany({ where: { kind: "one_time", status: "scheduled", scheduledAt: { lte: now } } });
    for (const campaign of due) {
      const config = await loadConfig(campaign.businessId, tx);
      const count = await materialize(tx, { campaign, config, runKey: "once", today: localDate(now, config.utcOffsetMinutes) });
      await tx.marketingCampaign.update({ where: { id: campaign.id }, data: count
        ? { status: "sending", startedAt: now }
        : { status: "completed", startedAt: now, completedAt: now } });
      started.push({ id: campaign.id, recipients: count });
    }
    const automations = await tx.marketingCampaign.findMany({ where: { kind: { not: "one_time" }, status: "active" } });
    for (const campaign of automations) {
      const config = await loadConfig(campaign.businessId, tx);
      const today = localDate(now, config.utcOffsetMinutes);
      if (campaign.lastRunOn === today || minutesOfDay(now, config.utcOffsetMinutes) < (campaign.sendHour ?? 11) * 60) continue;
      const count = await materialize(tx, { campaign, config, runKey: today, today });
      await tx.marketingCampaign.update({ where: { id: campaign.id }, data: { lastRunOn: today, startedAt: campaign.startedAt || now } });
      started.push({ id: campaign.id, recipients: count, run: today });
    }
  }, { timeout: 120000 });
  return started;
};

let dispatchTimer = null;
let schedulerTimer = null;
let dispatching = false;
export const startMarketingWorker = ({ dispatchMs = 3000, schedulerMs = 60000 } = {}) => {
  if (dispatchTimer || String(process.env.MARKETING_WORKER || "").toLowerCase() === "off") return;
  const dispatch = async () => {
    if (dispatching) return;
    dispatching = true;
    try { await dispatchBatch(); } catch (error) { logger.warn(`Marketing dispatch failed: ${error.message}`); } finally { dispatching = false; }
  };
  dispatchTimer = setInterval(dispatch, dispatchMs);
  schedulerTimer = setInterval(() => { runScheduler().catch((error) => logger.warn(`Marketing scheduler failed: ${error.message}`)); }, schedulerMs);
  dispatchTimer.unref?.();
  schedulerTimer.unref?.();
};
export const stopMarketingWorker = () => {
  clearInterval(dispatchTimer);
  clearInterval(schedulerTimer);
  dispatchTimer = null;
  schedulerTimer = null;
};
