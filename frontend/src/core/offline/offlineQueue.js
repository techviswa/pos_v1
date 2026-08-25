import axios from "axios";

const API_URL = process.env.REACT_APP_BACKEND_URL;
const OFFLINE_QUEUE_KEY = "cashflow-lite-offline-client-events";

const readQueue = () => {
  try {
    return JSON.parse(window.localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
};

const writeQueue = (queue) => {
  try {
    window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-200)));
  } catch {
    // Storage limits should not break the active POS screen.
  }
};

export const getOfflineQueue = () => readQueue();

export const queueOfflineEvent = ({ resource, action, payload, idempotencyKey }) => {
  const event = {
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    resource,
    action,
    payload,
    idempotency_key: idempotencyKey || `${resource}_${action}_${Date.now()}`,
    queued_at: new Date().toISOString(),
  };
  writeQueue([...readQueue(), event]);
  window.dispatchEvent(new CustomEvent("cashflow-offline-queue-updated"));
  return event;
};

export const replayOfflineQueue = async () => {
  const queue = readQueue();
  if (!queue.length || !navigator.onLine) {
    return { replayed: 0, remaining: queue.length };
  }

  const remaining = [];
  let replayed = 0;

  for (const event of queue) {
    try {
      await axios.post(`${API_URL}/api/sync/client-events`, event, {
        withCredentials: true,
        skipCache: true,
      });
      replayed += 1;
    } catch {
      remaining.push(event);
    }
  }

  writeQueue(remaining);
  window.dispatchEvent(new CustomEvent("cashflow-offline-queue-updated"));
  return { replayed, remaining: remaining.length };
};
