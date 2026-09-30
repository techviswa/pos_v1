import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import env from "../../config/env.js";

/**
 * Feedback links are printed on receipts and open a public form. The token proves the link was issued by this
 * server for one specific bill, so nobody can post feedback against a bill id they merely guessed.
 *
 * Format: fb_<billId>_<hmac>. Stateless, stable across restarts and deploys.
 */
const secret = () =>
  process.env.FEEDBACK_TOKEN_SECRET ||
  (env.auth.jwtSecret && env.auth.jwtSecret !== "change-me" ? env.auth.jwtSecret : "") ||
  // Last resort: derive from private deployment configuration instead of a value that is public in the repository.
  createHash("sha256").update(`${env.database.url}|feedback-token`).digest("hex");

const mac = (billId) => createHmac("sha256", secret()).update(String(billId)).digest("base64url").slice(0, 32);

export const signFeedbackToken = (billId) => `fb_${billId}_${mac(billId)}`;

/** Returns the bill id a valid token was issued for, or null. */
export const verifyFeedbackToken = (token) => {
  const match = /^fb_([A-Za-z0-9_-]{1,64})_([A-Za-z0-9_-]{32})$/.exec(String(token || ""));
  if (!match) return null;
  const [, billId, supplied] = match;
  const expected = Buffer.from(mac(billId));
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? billId : null;
};
