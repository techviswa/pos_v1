import { EventEmitter } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

import env from "../../config/env.js";
import prisma from "../../database/prisma/client.js";
import { logger } from "../../shared/utils/logger.js";

/**
 * Live "something changed" signals for staff screens (kitchen, waiter, billing, QR inbox, tables).
 *
 * Events are invalidation hints, never data: { id, resource, action, record_id, outlet_id, at }. A screen that
 * receives one re-fetches through the normal authorised API, so nothing leaks through this channel and a lost
 * event only delays a refresh (clients also re-fetch on reconnect and on a slow safety timer).
 *
 * Delivery uses PostgreSQL NOTIFY/LISTEN: NOTIFY issued inside a transaction is delivered only if it commits, and
 * every API instance listening on the same database receives it, so this works behind a load balancer.
 */
const CHANNEL = "pos_realtime";
const TICKET_TTL_MS = 60_000;
const HEARTBEAT_MS = 25_000;
const MAX_STREAMS_PER_BUSINESS = 200;

const bus = new EventEmitter();
bus.setMaxListeners(0);
const tickets = new Map();
const streamCounts = new Map();

let listener = null;
let listenerStarting = null;
let retryTimer = null;
let stopped = false;

const deliverLocally = (event) => {
  if (!event?.business_id) return;
  bus.emit(`business:${event.business_id}`, event);
};

const connectListener = async () => {
  if (stopped || listener) return;
  const client = new pg.Client({ connectionString: env.database.url });
  client.on("notification", (message) => {
    if (message.channel !== CHANNEL) return;
    try {
      deliverLocally(JSON.parse(message.payload));
    } catch {
      // malformed payloads are ignored
    }
  });
  const reconnect = (error) => {
    if (listener === client) listener = null;
    client.removeAllListeners("end");
    client.end().catch(() => {});
    if (stopped) return;
    logger.warn(`Realtime listener disconnected${error ? `: ${error.message}` : ""}; retrying`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { void ensureListener(); }, 5000);
    retryTimer.unref?.();
  };
  client.on("error", reconnect);
  client.on("end", () => reconnect());
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  listener = client;
};

export const ensureListener = () => {
  if (stopped || listener) return Promise.resolve();
  if (!listenerStarting) {
    listenerStarting = connectListener()
      .catch((error) => {
        logger.warn(`Realtime listener could not connect: ${error.message}`);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { void ensureListener(); }, 5000);
        retryTimer.unref?.();
      })
      .finally(() => { listenerStarting = null; });
  }
  return listenerStarting;
};

export const stopRealtime = async () => {
  stopped = true;
  clearTimeout(retryTimer);
  const client = listener;
  listener = null;
  if (client) {
    client.removeAllListeners("end");
    await client.end().catch(() => {});
  }
};

/**
 * Publish a change signal. Pass the transaction client when the change is part of one, so the signal is only
 * delivered if it commits. Never throws for callers outside a transaction.
 */
export const publishChange = async ({ businessId, resource, action = "updated", recordId = null, outletId = null }, { tx } = {}) => {
  if (!businessId || !resource) return;
  const payload = JSON.stringify({
    id: randomUUID(),
    business_id: String(businessId),
    resource: String(resource).slice(0, 40),
    action: String(action).slice(0, 40),
    record_id: recordId ? String(recordId).slice(0, 64) : null,
    outlet_id: outletId ? String(outletId).slice(0, 64) : null,
    at: new Date().toISOString(),
  });
  if (tx) {
    await tx.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
    return;
  }
  try {
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  } catch (error) {
    logger.warn(`Realtime publish failed: ${error.message}`);
  }
};

/** A single-use, short-lived ticket lets EventSource (which cannot send headers) open the stream as this user. */
export const issueStreamTicket = ({ user, context }) => {
  const now = Date.now();
  for (const [key, entry] of tickets) if (entry.expiresAt < now) tickets.delete(key);
  const ticket = randomBytes(24).toString("base64url");
  tickets.set(ticket, {
    userId: user.id,
    businessId: context.businessId,
    outletScope: context.outletScope || null,
    expiresAt: now + TICKET_TTL_MS,
  });
  return { ticket, expires_in_seconds: TICKET_TTL_MS / 1000 };
};

const redeemTicket = (ticket) => {
  const entry = tickets.get(String(ticket || ""));
  tickets.delete(String(ticket || ""));
  return entry && entry.expiresAt >= Date.now() ? entry : null;
};

export const openStream = (req, res) => {
  const session = redeemTicket(req.query?.ticket);
  if (!session) {
    res.status(401).json({ success: false, error: { code: "STREAM_TICKET_INVALID", message: "Stream ticket is invalid or expired" } });
    return;
  }
  const open = streamCounts.get(session.businessId) || 0;
  if (open >= MAX_STREAMS_PER_BUSINESS) {
    res.status(429).json({ success: false, error: { code: "TOO_MANY_STREAMS", message: "Too many live connections" } });
    return;
  }
  streamCounts.set(session.businessId, open + 1);
  void ensureListener();

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write("retry: 5000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const onEvent = (event) => {
    // Outlet-restricted staff only hear about their own outlets (and business-wide changes).
    if (session.outletScope && event.outlet_id && !session.outletScope.includes(event.outlet_id)) return;
    res.write(`id: ${event.id}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const channel = `business:${session.businessId}`;
  bus.on(channel, onEvent);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  heartbeat.unref?.();

  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off(channel, onEvent);
    streamCounts.set(session.businessId, Math.max(0, (streamCounts.get(session.businessId) || 1) - 1));
  });
};

// Exposed for tests.
export const realtimeInternals = { bus, deliverLocally, tickets };
