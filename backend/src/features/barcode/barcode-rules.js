import { randomInt } from "node:crypto";
import { createHttpError } from "../../shared/utils/http-error.js";
import { featureToggleService } from "../../services/featureToggleService.js";
import { FEATURE_KEYS } from "../../shared/constants/module.constants.js";

// Product barcodes: a manufacturer code typed or scanned in, or an in-store EAN-13 generated here. In-store codes
// start with "20" (the GS1 range reserved for a shop's own items), so they never collide with packaged goods.
const PATTERN = /^[A-Za-z0-9-]{4,32}$/;

/** null for "no barcode"; otherwise the trimmed code, or a 400 explaining the allowed format. */
export const normalizeBarcode = (value) => {
  if (value === undefined) return undefined;
  const code = String(value ?? "").trim();
  if (!code) return null;
  if (!PATTERN.test(code)) throw createHttpError({ statusCode: 400, code: "BARCODE_INVALID", message: "A barcode is 4 to 32 letters, digits or dashes" });
  return code;
};

export const ean13CheckDigit = (twelveDigits) => {
  const sum = [...twelveDigits].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
};
export const isValidEan13 = (code) => /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code[12];

export const assertBarcodeFeature = async (businessId) => {
  if (!await featureToggleService.isFeatureEnabled(FEATURE_KEYS.BARCODE, businessId)) {
    throw createHttpError({ statusCode: 403, code: "FEATURE_DISABLED", message: "Barcodes are not included in this business's plan" });
  }
};

export const assertBarcodeFree = async (client, businessId, code, exceptProductId = null) => {
  if (!code) return;
  const owner = await client.product.findFirst({ where: { businessId, barcode: code, ...(exceptProductId ? { id: { not: exceptProductId } } : {}) }, select: { name: true } });
  if (owner) throw createHttpError({ statusCode: 409, code: "BARCODE_IN_USE", message: `Barcode ${code} is already used by ${owner.name}` });
};

/** A new in-store EAN-13 not yet used in this business. */
export const nextInStoreBarcode = async (client, businessId) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const body = `20${String(randomInt(0, 10 ** 10)).padStart(10, "0")}`;
    const code = body + ean13CheckDigit(body);
    if (!await client.product.findFirst({ where: { businessId, barcode: code }, select: { id: true } })) return code;
  }
  throw createHttpError({ statusCode: 503, message: "Could not find a free barcode; try again" });
};

/** Checks a product's new barcode (plan, format, uniqueness). Returns the value to store, or undefined for "unchanged". */
export const resolveProductBarcode = async ({ client, businessId, payload, current = null, productId = null }) => {
  const code = normalizeBarcode(payload.barcode);
  if (code === undefined || code === (current ?? null)) return undefined;
  if (code) {
    await assertBarcodeFeature(businessId);
    await assertBarcodeFree(client, businessId, code, productId);
  }
  return code;
};
