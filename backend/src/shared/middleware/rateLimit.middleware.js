import { createHttpError } from "../utils/http-error.js";

/**
 * Small fixed-window limiter (no external dependency). State is per process,
 * which bounds abuse on a single instance; put a shared store behind it if the
 * API is ever scaled horizontally.
 */
export const createRateLimiter = ({
  windowMs,
  max,
  keyFn = (req) => req.ip,
  code = "RATE_LIMITED",
  message = "Too many requests. Please try again later.",
} = {}) => {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.max(windowMs, 60_000));
  sweep.unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const key = String(keyFn(req) || "unknown");
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      return next(createHttpError({ statusCode: 429, code, message }));
    }
    return next();
  };
};

const emailKey = (req) => `${req.ip}|${String(req.body?.email || "").trim().toLowerCase()}`;

// Credential guessing: per IP+account, plus a coarser per-IP ceiling.
export const loginAccountLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 8,
  keyFn: emailKey,
  code: "LOGIN_RATE_LIMITED",
  message: "Too many login attempts. Please try again in a few minutes.",
});
export const loginIpLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 60,
  code: "LOGIN_RATE_LIMITED",
  message: "Too many login attempts. Please try again in a few minutes.",
});

// Mail-sending / token-consuming auth endpoints.
export const authSensitiveLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 10,
  keyFn: emailKey,
  code: "AUTH_RATE_LIMITED",
});

// Unauthenticated public surface (QR menu and order tracking, feedback, payment pages). Many guests of one
// restaurant can share its Wi-Fi (one IP) and the tracking page polls, so reads get a generous budget while
// writes (placing orders, requesting SMS codes, submitting feedback) are tight.
const publicReadLimiter = createRateLimiter({ windowMs: 60_000, max: 1200, code: "PUBLIC_RATE_LIMITED" });
const publicWriteLimiter = createRateLimiter({ windowMs: 60_000, max: 60, code: "PUBLIC_RATE_LIMITED" });

// Staff actions that live under /public/qr are authenticated and must not share the guests' budget.
const STAFF_QR_PATHS = [/^\/qr\/inbox\/?$/, /^\/qr\/orders\/[^/]+\/(approve|reject)\/?$/];

export const publicApiLimiter = (req, res, next) => {
  const relativePath = req.originalUrl.split("?")[0].replace(/^\/api\/public/, "");
  if (req.originalUrl.startsWith("/api/public/") && STAFF_QR_PATHS.some((pattern) => pattern.test(relativePath))) return next();
  // Delivery receipts from Meta/SMS providers arrive in bursts from a few IPs; they are signed or key-authenticated.
  if (req.originalUrl.startsWith("/api/public/marketing/") || req.originalUrl.startsWith("/api/public/payments/razorpay/")) return publicReadLimiter(req, res, next);
  // Printer agents are key-authenticated devices that poll and claim jobs continuously.
  if (req.originalUrl.startsWith("/api/printer/agent")) return publicReadLimiter(req, res, next);
  return (["GET", "HEAD", "OPTIONS"].includes(req.method) ? publicReadLimiter : publicWriteLimiter)(req, res, next);
};
