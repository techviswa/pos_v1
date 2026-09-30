import * as Sentry from "@sentry/react";

/**
 * Browser error reporting, on only when REACT_APP_SENTRY_DSN is set at build time.
 *
 * Nothing personal is sent: no IP address, no user details, no request bodies or query strings. Secret parts of URLs
 * (QR and order-tracking tokens, invite/feedback tokens, reset tokens) and phone numbers, emails and card-like numbers
 * in messages are replaced before an event leaves the browser.
 */
const PATH_SECRETS = [
  /(\/qr\/orders\/)[^/?#\s]+/gi,
  /(\/qr\/)(?!orders\b|inbox\b)[^/?#\s]+/gi,
  /(\/feedback\/(?:form\/)?)[^/?#\s]+/gi,
  /(\/invites?\/)[^/?#\s]+/gi,
  /(\/payslips\/)[^/?#\s]+/gi,
];
const PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\+?\d(?:[\s-]?\d){7,}/g, "[number]"],
];

export const scrubText = (value) => {
  if (value === null || value === undefined) return value;
  let text = String(value);
  for (const pattern of PATH_SECRETS) text = text.replace(pattern, "$1[redacted]");
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text;
};
// Query strings can carry reset tokens and stream tickets; they are dropped entirely.
export const scrubUrl = (url) => scrubText(String(url || "").split(/[?#]/)[0]);

export const scrubEvent = (event) => {
  if (!event) return event;
  delete event.user;
  if (event.request) event.request = { url: event.request.url ? scrubUrl(event.request.url) : undefined };
  if (event.message) event.message = scrubText(event.message);
  for (const value of event.exception?.values || []) if (value.value) value.value = scrubText(value.value);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .filter((crumb) => crumb.category !== "console" && crumb.category !== "ui.input")
      .map((crumb) => ({
        ...crumb,
        message: crumb.message ? scrubText(crumb.message) : crumb.message,
        data: crumb.data ? {
          ...(crumb.data.url ? { url: scrubUrl(crumb.data.url) } : {}),
          ...(crumb.data.from ? { from: scrubUrl(crumb.data.from) } : {}),
          ...(crumb.data.to ? { to: scrubUrl(crumb.data.to) } : {}),
          ...(crumb.data.method ? { method: crumb.data.method } : {}),
          ...(crumb.data.status_code ? { status_code: crumb.data.status_code } : {}),
        } : undefined,
      }));
  }
  if (event.extra) event.extra = JSON.parse(scrubText(JSON.stringify(event.extra)));
  return event;
};

let ready = false;
export const initErrorReporting = () => {
  const dsn = String(process.env.REACT_APP_SENTRY_DSN || "").trim();
  if (ready || !dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.REACT_APP_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.REACT_APP_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
  });
  ready = true;
  return true;
};

export const reportError = (error, context = {}) => {
  if (!ready) return;
  try {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) scope.setTag(key, scrubText(String(value)).slice(0, 100));
      Sentry.captureException(error);
    });
  } catch {
    // Reporting must never break the till.
  }
};
