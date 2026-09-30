import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptSecret } from "../../shared/utils/secrets.js";

/**
 * Minimal Razorpay REST client (https://razorpay.com/docs/api/). Amounts are integers in paise.
 *
 * Replies are reduced to the fields the POS needs; raw bodies and credentials are never logged or stored.
 */
const BASE_URL = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 15000;

let fetchImpl = (...args) => fetch(...args);
/** Tests replace the network. */
export const setRazorpayFetch = (implementation) => { fetchImpl = implementation || ((...args) => fetch(...args)); };

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const fromPaise = (paise) => Math.round(Number(paise)) / 100;

export class RazorpayError extends Error {
  constructor(message, { status = 0, code = null, retryable = false } = {}) {
    super(message);
    this.name = "RazorpayError";
    this.status = status;
    this.gatewayCode = code;
    this.retryable = retryable;
  }
}

const credentials = (config) => {
  const keySecret = decryptSecret(config?.keySecretEnc);
  if (!config?.keyId || !keySecret) throw new RazorpayError("Razorpay keys are not set", { code: "NOT_CONFIGURED" });
  return Buffer.from(`${config.keyId}:${keySecret}`).toString("base64");
};

export const razorpayRequest = async (config, method, path, body) => {
  const auth = credentials(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new RazorpayError(error?.name === "AbortError" ? "Razorpay did not answer in time" : "Could not reach Razorpay", { retryable: true });
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await response.json(); } catch { /* not json */ }
  if (!response.ok) {
    const description = String(data?.error?.description || "").slice(0, 200);
    throw new RazorpayError(response.status === 401 ? "Razorpay rejected the API keys" : `Razorpay: ${description || `error ${response.status}`}`, {
      status: response.status, code: data?.error?.code || null, retryable: response.status === 429 || response.status >= 500,
    });
  }
  return data;
};

/** Checks X-Razorpay-Signature (HMAC-SHA256 of the raw body with the webhook secret). */
export const validWebhookSignature = (rawBody, signature, secret) => {
  if (!rawBody || !signature || !secret) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
};

export const razorpay = {
  verifyKeys: (config) => razorpayRequest(config, "GET", "/payments?count=1"),
  createQr: (config, body) => razorpayRequest(config, "POST", "/payments/qr_codes", body),
  closeQr: (config, qrId) => razorpayRequest(config, "POST", `/payments/qr_codes/${encodeURIComponent(qrId)}/close`),
  qrPayments: (config, qrId) => razorpayRequest(config, "GET", `/payments/qr_codes/${encodeURIComponent(qrId)}/payments`),
  createLink: (config, body) => razorpayRequest(config, "POST", "/payment_links", body),
  fetchLink: (config, linkId) => razorpayRequest(config, "GET", `/payment_links/${encodeURIComponent(linkId)}`),
  cancelLink: (config, linkId) => razorpayRequest(config, "POST", `/payment_links/${encodeURIComponent(linkId)}/cancel`),
  fetchPayment: (config, paymentId) => razorpayRequest(config, "GET", `/payments/${encodeURIComponent(paymentId)}`),
  capture: (config, paymentId, amount) => razorpayRequest(config, "POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency: "INR" }),
  refund: (config, paymentId, body) => razorpayRequest(config, "POST", `/payments/${encodeURIComponent(paymentId)}/refund`, body),
  listRefunds: (config, paymentId) => razorpayRequest(config, "GET", `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`),
};
