import env from "../../config/env.js";
import { createHttpError } from "../../shared/utils/http-error.js";

/**
 * The owner's "Plan & billing" screen. Plans, prices, payments and Razorpay subscriptions live in AdminCore (Taskoora's
 * own Razorpay account); the POS only asks AdminCore on the owner's behalf, over the bridge key, for this business.
 * The resulting subscription status reaches the POS the usual way: AdminCore pushes it once Razorpay confirms payment.
 */
const TIMEOUT_MS = 15000;
let fetchImpl = (...args) => fetch(...args);
/** Tests replace the network. */
export const setSaasBillingFetch = (implementation) => { fetchImpl = implementation || ((...args) => fetch(...args)); };

const baseUrl = () => String(env.admincore.apiBaseUrl || "").replace(/\/+$/, "");

const callAdminCore = async (method, path, body) => {
  if (!env.admincore.enabled || !baseUrl() || !env.admincore.apiKey) {
    throw createHttpError({ statusCode: 503, code: "BILLING_UNAVAILABLE", message: "Online plan payments are not available for this account yet. Contact Taskoora support." });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${baseUrl()}/api/billing${path}`, {
      method,
      headers: { "content-type": "application/json", "x-admincore-api-key": env.admincore.apiKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw createHttpError({ statusCode: 502, code: "BILLING_UNREACHABLE", message: "Could not reach Taskoora billing. Try again shortly." });
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await response.json(); } catch { /* not json */ }
  if (!response.ok) {
    const detail = data?.detail;
    throw createHttpError({
      statusCode: [400, 404, 409].includes(response.status) ? response.status : 502,
      code: detail?.code || "BILLING_ERROR",
      message: detail?.message || (typeof detail === "string" ? detail : "Taskoora billing could not complete the request"),
    });
  }
  return data;
};

const scopeQuery = (context) => `?tenant_id=${encodeURIComponent(context.tenantId)}`;

export const saasBillingService = {
  status(context) {
    return callAdminCore("GET", `/pos/${encodeURIComponent(context.businessId)}${scopeQuery(context)}`);
  },

  checkout(context, user, payload = {}) {
    const planSlug = String(payload.plan_slug || "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,40}$/.test(planSlug)) throw createHttpError({ statusCode: 400, code: "PLAN_INVALID", message: "Choose a plan" });
    const cycle = payload.billing_cycle === "yearly" ? "yearly" : "monthly";
    return callAdminCore("POST", `/pos/${encodeURIComponent(context.businessId)}/checkout`, {
      tenant_id: context.tenantId, plan_slug: planSlug, billing_cycle: cycle,
      actor_id: user.id, actor_email: user.email, notify_email: user.email || undefined,
    });
  },

  cancel(context, user) {
    return callAdminCore("POST", `/pos/${encodeURIComponent(context.businessId)}/cancel`, {
      tenant_id: context.tenantId, actor_id: user.id, actor_email: user.email,
    });
  },
};
