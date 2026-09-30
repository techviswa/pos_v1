import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { normalizePhone } from "../customers/customer-core.js";
import { decryptSecret } from "./providers.js";

/**
 * Callbacks from Meta and SMS providers: delivery receipts and replies. A reply of STOP (or UNSUBSCRIBE) withdraws
 * marketing consent immediately; START gives it again. WhatsApp callbacks are accepted only with a valid
 * X-Hub-Signature-256 made with that business's app secret; SMS callbacks carry the business's secret key in the URL.
 */
const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE", "STOP PROMOTIONS", "STOP ALL", "OPT OUT", "OPTOUT", "CANCEL"]);
const START_WORDS = new Set(["START", "SUBSCRIBE", "UNSTOP"]);
const RANK = { queued: 0, sending: 1, sent: 2, delivered: 3, read: 4 };

const setConsent = async (businessId, rawPhone, text) => {
  const word = String(text || "").trim().toUpperCase().replace(/\s+/g, " ");
  const stop = STOP_WORDS.has(word);
  const start = START_WORDS.has(word);
  if (!stop && !start) return null;
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  const now = new Date();
  const updated = await prisma.customer.updateMany({
    where: { businessId, phone, anonymizedAt: null },
    data: stop ? { marketingOptIn: false, marketingOptOutAt: now } : { marketingOptIn: true, marketingConsentAt: now, marketingOptOutAt: null },
  });
  if (stop) {
    // Anything still waiting for this person is dropped at once.
    await prisma.marketingMessage.updateMany({ where: { businessId, phone, status: "queued" }, data: { status: "skipped", skipReason: "opted_out" } });
  }
  return updated.count ? (stop ? "opted_out" : "opted_in") : null;
};

/** Moves a message forward (sent -> delivered -> read); never backwards, and a late "failed" does not undo a delivery. */
const applyStatus = async (businessId, providerMessageId, status, error) => {
  if (!providerMessageId) return;
  const message = await prisma.marketingMessage.findFirst({ where: { businessId, providerMessageId: String(providerMessageId) } });
  if (!message) return;
  const now = new Date();
  if (status === "failed") {
    if ((RANK[message.status] ?? 0) >= RANK.delivered) return;
    await prisma.marketingMessage.update({ where: { id: message.id }, data: { status: "failed", error: String(error || "Not delivered").slice(0, 200) } });
    return;
  }
  if (!(status in RANK) || (RANK[message.status] ?? -1) >= RANK[status]) return;
  await prisma.marketingMessage.update({ where: { id: message.id }, data: {
    status,
    ...(status === "delivered" || status === "read" ? { deliveredAt: message.deliveredAt || now } : {}),
    ...(status === "read" ? { readAt: now } : {}),
  } });
};

export const verifyWhatsAppSubscription = async (query = {}) => {
  if (query["hub.mode"] !== "subscribe" || !query["hub.verify_token"]) return null;
  const config = await prisma.marketingConfig.findFirst({ where: { whatsappVerifyToken: String(query["hub.verify_token"]) }, select: { id: true } });
  return config ? String(query["hub.challenge"] ?? "") : null;
};

const signatureValid = (rawBody, header, secret) => {
  if (!rawBody || !header || !secret) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(String(header));
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/** Returns false when the signature does not match any connected business. */
export const receiveWhatsApp = async ({ rawBody, signature, body }) => {
  const changes = (body?.entry || []).flatMap((entry) => entry.changes || []).map((change) => change.value || {});
  const phoneNumberIds = [...new Set(changes.map((value) => value.metadata?.phone_number_id).filter(Boolean).map(String))];
  if (!phoneNumberIds.length) return false;
  const configs = await prisma.marketingConfig.findMany({ where: { whatsappPhoneNumberId: { in: phoneNumberIds } } });
  const verified = new Map(configs.filter((config) => signatureValid(rawBody, signature, decryptSecret(config.whatsappAppSecretEnc))).map((config) => [config.whatsappPhoneNumberId, config]));
  if (!verified.size) return false;
  for (const value of changes) {
    const config = verified.get(String(value.metadata?.phone_number_id || ""));
    if (!config) continue;
    for (const status of value.statuses || []) {
      await applyStatus(config.businessId, status.id, status.status, status.errors?.[0]?.title || status.errors?.[0]?.message);
    }
    for (const message of value.messages || []) {
      await setConsent(config.businessId, message.from, message.text?.body || message.button?.text || message.button?.payload || message.interactive?.button_reply?.title);
    }
  }
  return true;
};

const SMS_STATUS = {
  delivered: "delivered", delivrd: "delivered", success: "delivered", "1": "delivered",
  sent: "sent", queued: "sent", accepted: "sent", sending: "sent",
  failed: "failed", undelivered: "failed", undeliv: "failed", rejected: "failed", expired: "failed", "2": "failed", "16": "failed",
};

export const receiveSmsStatus = async ({ key, body = {} }) => {
  const config = await prisma.marketingConfig.findUnique({ where: { smsWebhookKey: String(key || "") } });
  if (!config) return false;
  const rows = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [body];
  for (const row of rows) {
    const id = row.MessageSid || row.message_id || row.messageId || row.request_id || row.requestId || row.id;
    const status = SMS_STATUS[String(row.MessageStatus || row.status || row.report_status || row.desc || "").trim().toLowerCase()];
    if (id && status) await applyStatus(config.businessId, id, status, row.ErrorCode ? `SMS error ${row.ErrorCode}` : row.failure_reason);
  }
  return true;
};

export const receiveSmsInbound = async ({ key, body = {} }) => {
  const config = await prisma.marketingConfig.findUnique({ where: { smsWebhookKey: String(key || "") } });
  if (!config) return false;
  await setConsent(config.businessId, body.From || body.from || body.mobile || body.sender, body.Body || body.text || body.message || body.content);
  return true;
};
