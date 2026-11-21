import { saasStore } from "../saas/saas-store.js";
import { createHttpError } from "../../shared/utils/http-error.js";

export const FULFILLMENT_MODES = ["TABLE", "TOKEN", "PICKUP", "DELIVERY"];
export function validateFulfillmentPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 4 ||
      FULFILLMENT_MODES.some(key => typeof value[key] !== "boolean")) {
    throw createHttpError({ statusCode: 400, code: "INVALID_FULFILLMENT_POLICY", message: "Provide TABLE, TOKEN, PICKUP and DELIVERY as booleans" });
  }
  return Object.fromEntries(FULFILLMENT_MODES.map(key => [key, value[key]]));
}
export async function getFulfillmentPolicy(businessId) {
  const config = await saasStore.getBusinessConfig(businessId);
  return config?.fulfillment_modes === undefined ? Object.fromEntries(FULFILLMENT_MODES.map(key => [key, true]))
    : validateFulfillmentPolicy(config.fulfillment_modes);
}
export function resolveBillingMode(payload = {}) {
  const channel = String(payload.channel || "").trim().toLowerCase();
  const value = payload.service_mode || payload.fulfillment_mode || payload.order_type || payload.menu_channel ||
    (["delivery", "pickup", "takeaway", "dine-in"].includes(channel) ? channel : "TABLE");
  const key = String(value).trim().toUpperCase().replace(/[\s_-]/g, "");
  const aliases = { TABLE: "TABLE", DINEIN: "TABLE", QR: "TABLE", TOKEN: "TOKEN", TAKEAWAY: "TOKEN", PICKUP: "PICKUP", DELIVERY: "DELIVERY" };
  if (!aliases[key]) throw createHttpError({ statusCode: 400, code: "INVALID_FULFILLMENT_MODE", message: "Select a valid billing mode" });
  return aliases[key];
}
export async function assertFulfillmentEnabled(businessId, payload) {
  const mode = resolveBillingMode(payload);
  const policy = await getFulfillmentPolicy(businessId);
  if (!policy[mode]) throw createHttpError({ statusCode: 403, code: "FULFILLMENT_MODE_DISABLED", message: `${mode} billing is disabled by AdminCore. Select an enabled billing mode.` });
  return mode;
}
