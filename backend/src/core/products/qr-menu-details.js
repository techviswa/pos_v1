import { createHttpError } from "../../shared/utils/http-error.js";

const bad = (message) => createHttpError({ statusCode: 400, code: "INVALID_QR_MENU_DETAILS", message });
export const qrSettings = (product) => product.channelSettings?.qr || product.channelSettings?.qr_ordering || {};
export function normalizeChannelSettings(incoming, existing = {}) {
  if (incoming === undefined) return existing;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw bad("Channel settings must be an object");
  const result = { ...existing, ...incoming };
  for (const key of ["qr", "qr_ordering"]) {
    if (incoming[key] === undefined) continue;
    const qr = incoming[key];
    if (!qr || typeof qr !== "object" || Array.isArray(qr)) throw bad("QR menu settings must be an object");
    const next = { ...(existing[key] || {}), ...qr };
    if (qr.description !== undefined && (typeof qr.description !== "string" || qr.description.length > 500)) throw bad("Menu description must be at most 500 characters");
    for (const name of ["allergens", "may_contain"]) {
      if (qr[name] === undefined) continue;
      if (!Array.isArray(qr[name]) || qr[name].length > 20 || qr[name].some((item) => typeof item !== "string" || !item.trim() || item.length > 60)) throw bad("Allergens must be a list of up to 20 names, each at most 60 characters");
      next[name] = [...new Set(qr[name].map((item) => item.trim()))];
    }
    for (const name of ["enabled", "sold_out", "enforce_stock", "allergens_reviewed"]) {
      if (qr[name] !== undefined && typeof qr[name] !== "boolean") throw bad(`${name} must be true or false`);
    }
    result[key] = next;
  }
  return result;
}
export const guestMenuDetails = (product) => {
  const qr = qrSettings(product);
  return {
    description: typeof qr.description === "string" ? qr.description : "",
    allergens_reviewed: qr.allergens_reviewed === true,
    allergens: Array.isArray(qr.allergens) ? qr.allergens : [],
    may_contain: Array.isArray(qr.may_contain) ? qr.may_contain : [],
  };
};
export function qrSaleState(product, stock = product.stock) {
  const qr = qrSettings(product);
  if (qr.sold_out === true) return { available: false, reason: "Sold out" };
  if (qr.enforce_stock === true && Number(stock) <= 0) return { available: false, reason: "Sold out" };
  return { available: true, reason: null, max_quantity: qr.enforce_stock === true ? Math.max(0, Math.floor(Number(stock))) : null };
}
