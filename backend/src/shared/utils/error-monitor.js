import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as Sentry from "@sentry/node";
import { scrubPath, scrubText } from "./scrub.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDirectory = path.resolve(__dirname, "../../../logs");
const errorLogPath = path.join(logDirectory, "errors.jsonl");

/**
 * Error reporting.
 *
 * Every captured error is appended to logs/errors.jsonl. When SENTRY_DSN is set, server faults (5xx, crashes,
 * failed jobs) are also sent to Sentry so someone is alerted. Nothing personal leaves the server: no request bodies,
 * cookies, headers, query strings, IP addresses or emails; secret path segments, tokens, phone numbers and emails in
 * messages are replaced. Expected client errors (4xx) are never sent.
 */
const dsn = () => String(process.env.SENTRY_DSN || process.env.ERROR_MONITORING_DSN || "").trim();
let sentryReady = false;

const scrubEvent = (event) => {
  if (!event) return event;
  delete event.user;
  delete event.server_name;
  if (event.request) {
    event.request = { method: event.request.method, url: event.request.url ? scrubPath(event.request.url) : undefined };
  }
  if (event.message) event.message = scrubText(event.message);
  for (const value of event.exception?.values || []) {
    if (value.value) value.value = scrubText(value.value);
    for (const frame of value.stacktrace?.frames || []) {
      delete frame.vars;
      delete frame.pre_context;
      delete frame.context_line;
      delete frame.post_context;
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message ? scrubText(crumb.message) : crumb.message,
      data: crumb.data?.url ? { method: crumb.data.method, url: scrubPath(crumb.data.url), status_code: crumb.data.status_code } : undefined,
    }));
  }
  if (event.extra) event.extra = JSON.parse(scrubText(JSON.stringify(event.extra)));
  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (!["os", "runtime", "app", "device", "trace"].includes(key)) event.contexts[key] = JSON.parse(scrubText(JSON.stringify(event.contexts[key])));
    }
  }
  return event;
};

export const initErrorReporting = () => {
  if (sentryReady || !dsn()) return false;
  Sentry.init({
    dsn: dsn(),
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || process.env.RENDER_GIT_COMMIT || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // No source lines or local variables in reports: only file names, functions and line numbers.
    integrations: (defaults) => defaults.filter((integration) => !['ContextLines', 'LocalVariables'].includes(integration.name)),
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
    beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
  });
  sentryReady = true;
  return true;
};

export const flushErrorReporting = async (timeoutMs = 2000) => {
  if (sentryReady) await Sentry.flush(timeoutMs).catch(() => false);
};

const redactHeaders = (headers = {}) => {
  const safeHeaders = { ...headers };
  for (const name of ["authorization", "cookie", "x-cf-session-id", "x-admincore-api-key", "x-api-key", "x-razorpay-signature", "x-hub-signature-256"]) {
    if (safeHeaders[name]) safeHeaders[name] = "[redacted]";
  }
  return safeHeaders;
};

const toErrorPayload = (error) => ({
  name: error?.name || "Error",
  message: scrubText(error?.message || String(error)),
  stack: error?.stack ? scrubText(error.stack) : null,
  code: error?.code || null,
  statusCode: error?.statusCode || null,
});

const writeEvent = async (event) => {
  try {
    await mkdir(logDirectory, { recursive: true });
    await appendFile(errorLogPath, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Monitoring must never break request handling.
  }
};

const isServerFault = (error) => !error?.statusCode || Number(error.statusCode) >= 500;

const sendToSentry = (error, context) => {
  if (!sentryReady || !isServerFault(error)) return;
  try {
    Sentry.withScope((scope) => {
      // Only identifiers and routing facts; never personal data.
      for (const key of ["lifecycle", "job_type", "method", "code", "signal"]) if (context[key]) scope.setTag(key, String(context[key]).slice(0, 60));
      if (context.path) scope.setTag("path", scrubPath(context.path).slice(0, 200));
      if (context.businessId) scope.setTag("business_id", String(context.businessId).slice(0, 80));
      if (context.requestId) scope.setTag("request_id", String(context.requestId).slice(0, 80));
      if (error?.code) scope.setTag("error_code", String(error.code).slice(0, 60));
      Sentry.captureException(error instanceof Error ? error : new Error(scrubText(String(error))));
    });
  } catch {
    // Reporting must never break request handling.
  }
};

export const errorMonitor = {
  captureException(error, context = {}) {
    const event = {
      type: "exception",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      dsn_configured: Boolean(dsn()),
      error: toErrorPayload(error),
      context,
    };

    void writeEvent(event);
    sendToSentry(error, context);
    return event;
  },

  captureRequestException(error, req) {
    return this.captureException(error, {
      requestId: req.context?.requestId,
      method: req.method,
      path: scrubPath(req.originalUrl || req.url),
      userId: req.user?.id || null,
      tenantId: req.context?.tenantId || null,
      businessId: req.context?.businessId || null,
      headers: redactHeaders(req.headers),
    });
  },

  captureMessage(message, context = {}) {
    const event = {
      type: "message",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      dsn_configured: Boolean(dsn()),
      message: scrubText(message),
      context,
    };

    void writeEvent(event);
    if (sentryReady) {
      try { Sentry.captureMessage(scrubText(message), "warning"); } catch { /* never break callers */ }
    }
    return event;
  },
};

export const errorMonitorInternals = { scrubEvent };
