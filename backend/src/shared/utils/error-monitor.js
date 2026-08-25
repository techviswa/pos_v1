import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDirectory = path.resolve(__dirname, "../../../logs");
const errorLogPath = path.join(logDirectory, "errors.jsonl");

const redactHeaders = (headers = {}) => {
  const safeHeaders = { ...headers };
  if (safeHeaders.authorization) safeHeaders.authorization = "[redacted]";
  if (safeHeaders.cookie) safeHeaders.cookie = "[redacted]";
  return safeHeaders;
};

const toErrorPayload = (error) => ({
  name: error?.name || "Error",
  message: error?.message || String(error),
  stack: error?.stack || null,
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

export const errorMonitor = {
  captureException(error, context = {}) {
    const event = {
      type: "exception",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      dsn_configured: Boolean(process.env.ERROR_MONITORING_DSN),
      error: toErrorPayload(error),
      context,
    };

    void writeEvent(event);
    return event;
  },

  captureRequestException(error, req) {
    return this.captureException(error, {
      requestId: req.context?.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
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
      dsn_configured: Boolean(process.env.ERROR_MONITORING_DSN),
      message,
      context,
    };

    void writeEvent(event);
    return event;
  },
};
