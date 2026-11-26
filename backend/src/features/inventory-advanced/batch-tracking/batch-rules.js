import { createHttpError } from "../../../shared/utils/http-error.js";
import { featureToggleService } from "../../../services/featureToggleService.js";
import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";

const fail = (message, statusCode = 400) => { throw createHttpError({ statusCode, code: "BATCH_INVALID", message }); };

export const assertBatchFeature = async (businessId) => {
  if (!await featureToggleService.isFeatureEnabled(FEATURE_KEYS.BATCH_TRACKING, businessId)) {
    throw createHttpError({ statusCode: 403, code: "FEATURE_DISABLED", message: "Batch tracking is not included in this business's plan" });
  }
};

export const parseExpiry = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("Enter the batch expiry date");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail("Enter a valid batch expiry date");
  return date;
};

/** A receiving line's lot, or null when the line has no lot number. */
export const validateBatchLine = async ({ businessId, line = {} }) => {
  const batchNo = String(line.batch_no ?? line.batchNo ?? "").trim();
  if (!batchNo) return null;
  await assertBatchFeature(businessId);
  if (batchNo.length > 60) fail("A batch number is at most 60 characters");
  return { batchNo, expiryDate: parseExpiry(line.expiry_date ?? line.expiryDate) };
};

/**
 * How much of each lot is probably still on the shelf. Stock is used earliest-expiry-first, so what is left at a
 * location sits in the lots that expire last: the location's current stock is filled into lots from the latest expiry
 * backwards. This is an estimate (sales do not record lot numbers) and is labelled as such.
 */
export const estimateRemaining = (batches, currentStock) => {
  let left = Math.max(0, Number(currentStock) || 0);
  const remaining = new Map();
  for (const batch of [...batches].sort((a, b) => b.expiryDate - a.expiryDate || b.createdAt - a.createdAt)) {
    const take = Math.min(left, Number(batch.quantity) || 0);
    remaining.set(batch.id, Math.round(take * 1000) / 1000);
    left -= take;
  }
  return remaining;
};
