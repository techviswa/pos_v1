import axios from "axios";
import { API_URL } from "./apiUrl";

/**
 * One live connection per browser tab, shared by every screen that wants change notifications.
 *
 * The server sends only "something changed" hints ({ resource, action, record_id, outlet_id }); screens re-fetch
 * through the normal API. A short-lived single-use ticket (issued with this tab's session) opens the stream, so the
 * session itself never appears in a URL. After any disconnect a new ticket is requested and every subscriber is
 * told to reconcile (resource "*"), so nothing missed while offline stays stale.
 */
const subscribers = new Set();
let source = null;
let connecting = false;
let retryTimer = null;
let hasConnectedBefore = false;
let failures = 0;
// 5s, 10s, 20s ... capped at 2 minutes, so an unreachable server is not hammered.
const backoffMs = () => Math.min(120000, 5000 * 2 ** Math.min(failures, 5));

const notify = (event) => {
  subscribers.forEach((subscriber) => {
    try {
      subscriber(event);
    } catch (error) {
      console.error("Live update handler failed:", error);
    }
  });
};

const scheduleReconnect = (delayMs) => {
  window.clearTimeout(retryTimer);
  retryTimer = subscribers.size ? window.setTimeout(() => { retryTimer = null; void connect(); }, delayMs) : null;
};

const disconnect = () => {
  window.clearTimeout(retryTimer);
  retryTimer = null;
  if (source) source.close();
  source = null;
};

async function connect() {
  // A new screen subscribing must not bypass the back-off after a failure.
  if (retryTimer && failures) return;
  if (source || connecting || !subscribers.size || typeof window === "undefined" || !window.EventSource) return;
  connecting = true;
  try {
    const response = await axios.post(`${API_URL}/api/events/ticket`, {}, { withCredentials: true, skipCache: true });
    const ticket = response.data?.ticket || response.data?.data?.ticket;
    if (!ticket || !subscribers.size) return;
    const stream = new window.EventSource(`${API_URL}/api/events/stream?ticket=${encodeURIComponent(ticket)}`);
    source = stream;
    stream.addEventListener("ready", () => {
      failures = 0;
      if (hasConnectedBefore) notify({ resource: "*", action: "reconnected" });
      hasConnectedBefore = true;
    });
    stream.addEventListener("change", (message) => {
      try {
        notify(JSON.parse(message.data));
      } catch {
        // ignore malformed events
      }
    });
    stream.onerror = () => {
      // The ticket is single-use, so the browser's own retry cannot succeed: start over with a fresh ticket.
      stream.close();
      if (source === stream) source = null;
      failures += 1;
      scheduleReconnect(backoffMs());
    };
  } catch {
    failures += 1;
    scheduleReconnect(backoffMs());
  } finally {
    connecting = false;
  }
}

export const subscribeLiveUpdates = (subscriber) => {
  subscribers.add(subscriber);
  void connect();
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) disconnect();
  };
};
