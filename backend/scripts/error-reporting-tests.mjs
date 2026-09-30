import assert from "node:assert/strict";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import { scrubPath, scrubText } from "../src/shared/utils/scrub.js";

// A stand-in for Sentry: records exactly what the SDK transmits.
const received = [];
const sentry = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    received.push(req.headers["content-encoding"] === "gzip" ? gunzipSync(body).toString("utf8") : body.toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
await new Promise((resolve) => sentry.listen(0, "127.0.0.1", resolve));
process.env.SENTRY_DSN = `http://publickey@127.0.0.1:${sentry.address().port}/1`;

const { errorMonitor, flushErrorReporting, initErrorReporting } = await import("../src/shared/utils/error-monitor.js");

try {
  // Pure scrubbing rules.
  assert.equal(scrubPath("/api/public/qr/tok-123/menu?token=abc"), "/api/public/qr/[redacted]/menu");
  assert.equal(scrubPath("/api/public/qr/inbox"), "/api/public/qr/inbox", "fixed route names are kept");
  assert.equal(scrubPath("/api/public/marketing/sms/status/key-abc"), "/api/public/marketing/sms/status/[redacted]");
  assert.equal(scrubPath("/api/public/payments/razorpay/webhook/key-xyz"), "/api/public/payments/razorpay/webhook/[redacted]");
  assert.equal(scrubText("key rzp_live_ABCdef123 and Bearer eyJhbGci.x.y"), "key rzp_live_[redacted] and Bearer [redacted]");
  assert.equal(scrubText("call +91 98450 12345 or mail a.b@c.in"), "call [number] or mail [email]");

  assert.equal(initErrorReporting(), true);
  const req = {
    method: "POST",
    originalUrl: "/api/public/qr/SECRET-QR-TOKEN/orders?ticket=STREAM-TICKET",
    headers: { cookie: "sid=SESSION-COOKIE", authorization: "Bearer SECRET-BEARER", "x-cf-session-id": "SESSION-HEADER" },
    context: { requestId: "req-1", businessId: "biz-1", tenantId: "tenant-1" },
    user: { id: "user-1", email: "owner@example.com" },
    body: { customer_phone: "9845012345" },
  };
  errorMonitor.captureRequestException(new Error("Database failed for guest 9845012345 (asha@example.com)"), req);
  errorMonitor.captureRequestException(Object.assign(new Error("Not found"), { statusCode: 404 }), req);
  await flushErrorReporting(5000);

  const sent = received.join("\n");
  assert.ok(sent.includes("Database failed for guest [number] ([email])"), "the server fault is reported, scrubbed");
  assert.ok(!sent.includes("Not found"), "expected client errors are not reported");
  for (const secret of ["SECRET-QR-TOKEN", "STREAM-TICKET", "SESSION-COOKIE", "SECRET-BEARER", "SESSION-HEADER", "9845012345", "asha@example.com", "owner@example.com"]) {
    assert.ok(!sent.includes(secret), `${secret} must never reach the error service`);
  }
  assert.ok(sent.includes("/api/public/qr/[redacted]/orders"), "the route is kept for diagnosis");
  console.log("Error reporting: server faults reach Sentry; tokens, cookies, sessions, phone numbers and emails never do; 4xx are not reported");
} finally {
  await new Promise((resolve) => sentry.close(resolve));
}
process.exit(0);
