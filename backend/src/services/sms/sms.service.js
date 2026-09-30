import { createHttpError } from "../../shared/utils/http-error.js";

/**
 * Outbound SMS for one-time codes.
 *
 * SMS_PROVIDER=twilio   needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
 * SMS_PROVIDER=webhook  needs SMS_WEBHOOK_URL (HTTPS); SMS_WEBHOOK_TOKEN is sent as a bearer token.
 *                       Receives { to, message } — use it to plug in MSG91, Gupshup, an internal gateway, etc.
 * SMS_COUNTRY_CODE      prefix for 10-digit local numbers (default +91)
 *
 * Without a provider nothing is sent and `configured()` is false; callers must not pretend a code was delivered.
 */
const TIMEOUT_MS = 8000;

const provider = () => String(process.env.SMS_PROVIDER || "").trim().toLowerCase();

export const smsService = {
  configured() {
    if (provider() === "twilio") {
      return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
    }
    if (provider() === "webhook") {
      const url = String(process.env.SMS_WEBHOOK_URL || "");
      // Codes travel in the request body, so production requires HTTPS.
      return process.env.NODE_ENV === "production" ? /^https:\/\//i.test(url) : /^https?:\/\//i.test(url);
    }
    return false;
  },

  toInternational(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 10) return `${process.env.SMS_COUNTRY_CODE || "+91"}${digits}`;
    return `+${digits}`;
  },

  async send({ to, message, fetchImpl = fetch }) {
    if (!this.configured()) {
      throw createHttpError({ statusCode: 503, code: "SMS_NOT_CONFIGURED", message: "SMS delivery is not configured" });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let response;
      if (provider() === "twilio") {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
        response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: "POST",
          headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: this.toInternational(to), From: process.env.TWILIO_FROM, Body: message }).toString(),
          signal: controller.signal,
        });
      } else {
        response = await fetchImpl(process.env.SMS_WEBHOOK_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(process.env.SMS_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}),
          },
          body: JSON.stringify({ to: this.toInternational(to), message }),
          signal: controller.signal,
        });
      }
      if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
      return { sent: true };
    } catch (error) {
      // Provider error bodies can echo phone numbers or credentials; only a generic failure leaves this module.
      throw createHttpError({
        statusCode: 502,
        code: "SMS_SEND_FAILED",
        message: "The verification code could not be sent. Try again shortly.",
        details: { reason: error?.name === "AbortError" ? "timeout" : "provider_error" },
      });
    } finally {
      clearTimeout(timer);
    }
  },
};
