import { decryptSecret, encryptSecret } from "../../shared/utils/secrets.js";

export { decryptSecret, encryptSecret };

/**
 * Credentials and the WhatsApp / SMS provider clients used for marketing.
 *
 * Each business connects its own accounts. Tokens are stored encrypted (shared/utils/secrets.js). Provider replies are reduced to a message id or a short error
 * code: raw bodies can contain phone numbers or tokens and are never stored or logged.
 */
const TIMEOUT_MS = 10000;
/** National number to digits with country code, e.g. 9845012345 -> 919845012345. */
export const toInternationalDigits = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  const country = String(process.env.SMS_COUNTRY_CODE || "+91").replace(/\D/g, "");
  return digits.length === 10 ? `${country}${digits}` : digits;
};

let fetchImpl = (...args) => fetch(...args);
/** Tests replace the network. */
export const setMarketingFetch = (implementation) => { fetchImpl = implementation || ((...args) => fetch(...args)); };

const request = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    let body = null;
    try { body = await response.json(); } catch { /* not json */ }
    return { status: response.status, ok: response.ok, body };
  } catch (error) {
    return { status: 0, ok: false, body: null, networkError: error?.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
};

/** Outcome of one send: { ok, providerMessageId } or { ok: false, retry, error }. */
const outcome = (response, { idOf, describe }) => {
  if (response.ok) {
    const providerMessageId = idOf(response.body);
    return { ok: true, providerMessageId: providerMessageId ? String(providerMessageId).slice(0, 120) : null };
  }
  const retry = response.status === 0 || response.status === 429 || response.status >= 500;
  return { ok: false, retry, error: describe(response).slice(0, 200) };
};

// WhatsApp error codes that are worth retrying later (rate limits, temporary Meta issues).
const WHATSAPP_TRANSIENT = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

export const sendWhatsApp = async ({ config, template, to, parameters }) => {
  const token = decryptSecret(config.whatsappAccessTokenEnc);
  if (!config.whatsappEnabled || !config.whatsappPhoneNumberId || !token) return { ok: false, retry: false, error: "WhatsApp is not connected" };
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const response = await request(`https://graph.facebook.com/${version}/${encodeURIComponent(config.whatsappPhoneNumberId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toInternationalDigits(to),
      type: "template",
      template: {
        name: template.whatsappTemplateName,
        language: { code: template.language || "en" },
        ...(parameters.length ? { components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] } : {}),
      },
    }),
  });
  const result = outcome(response, {
    idOf: (body) => body?.messages?.[0]?.id,
    describe: (res) => {
      const error = res.body?.error;
      if (res.networkError) return `WhatsApp ${res.networkError}`;
      if (error?.code === 190 || res.status === 401) return "WhatsApp access token is invalid or expired";
      return `WhatsApp error ${error?.code || res.status}${error?.error_data?.details ? `: ${error.error_data.details}` : error?.message ? `: ${error.message}` : ""}`;
    },
  });
  if (!result.ok && WHATSAPP_TRANSIENT.has(Number(response.body?.error?.code))) result.retry = true;
  return result;
};

export const smsCredentials = (config) => {
  const raw = decryptSecret(config.smsCredentialsEnc);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
};

export const sendSms = async ({ config, template, to, text, parameters, statusCallbackUrl }) => {
  const credentials = smsCredentials(config);
  const provider = config.smsProvider;
  if (!config.smsEnabled || !provider) return { ok: false, retry: false, error: "SMS is not connected" };
  if (provider === "twilio") {
    if (!credentials.account_sid || !credentials.auth_token || !(credentials.from || credentials.messaging_service_sid)) return { ok: false, retry: false, error: "Twilio details are incomplete" };
    const auth = Buffer.from(`${credentials.account_sid}:${credentials.auth_token}`).toString("base64");
    const form = new URLSearchParams({ To: `+${toInternationalDigits(to)}`, Body: text });
    if (credentials.messaging_service_sid) form.set("MessagingServiceSid", credentials.messaging_service_sid);
    else form.set("From", credentials.from);
    if (statusCallbackUrl) form.set("StatusCallback", statusCallbackUrl);
    const response = await request(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.account_sid)}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return outcome(response, { idOf: (body) => body?.sid, describe: (res) => res.networkError ? `Twilio ${res.networkError}` : `Twilio error ${res.body?.code || res.status}${res.body?.message ? `: ${res.body.message}` : ""}` });
  }
  if (provider === "msg91") {
    if (!credentials.auth_key) return { ok: false, retry: false, error: "MSG91 auth key is missing" };
    if (!template.providerTemplateId) return { ok: false, retry: false, error: "This template has no MSG91 template id" };
    const recipient = { mobiles: toInternationalDigits(to) };
    parameters.forEach((value, index) => { recipient[`var${index + 1}`] = value; });
    const response = await request("https://control.msg91.com/api/v5/flow", {
      method: "POST",
      headers: { authkey: credentials.auth_key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ template_id: template.providerTemplateId, short_url: "0", recipients: [recipient] }),
    });
    if (response.ok && response.body?.type === "error") return { ok: false, retry: false, error: `MSG91: ${String(response.body.message || "rejected").slice(0, 150)}` };
    return outcome(response, { idOf: (body) => body?.message || body?.request_id, describe: (res) => res.networkError ? `MSG91 ${res.networkError}` : `MSG91 error ${res.status}` });
  }
  if (provider === "webhook") {
    const url = String(credentials.url || "");
    const secure = process.env.NODE_ENV === "production" ? /^https:\/\//i.test(url) : /^https?:\/\//i.test(url);
    if (!secure) return { ok: false, retry: false, error: "SMS gateway URL must be https" };
    const response = await request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(credentials.token ? { authorization: `Bearer ${credentials.token}` } : {}) },
      body: JSON.stringify({
        to: `+${toInternationalDigits(to)}`, message: text, variables: parameters, sender_id: config.smsSenderId || null,
        dlt_entity_id: config.smsDltEntityId || null, dlt_template_id: template.dltTemplateId || null,
        provider_template_id: template.providerTemplateId || null, status_callback_url: statusCallbackUrl || null,
      }),
    });
    return outcome(response, { idOf: (body) => body?.message_id || body?.id, describe: (res) => res.networkError ? `SMS gateway ${res.networkError}` : `SMS gateway error ${res.status}` });
  }
  return { ok: false, retry: false, error: "Unknown SMS provider" };
};
