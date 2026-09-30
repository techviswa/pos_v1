import axios from "axios";
import { API_URL } from "../../lib/apiUrl";

/**
 * Offline billing queue.
 *
 * When the connection drops, a cash/due bill is kept on this device and sent to the normal billing endpoint once the
 * connection is back. Each queued bill carries the checkout's client_request_id, so a bill that reached the server
 * just before the connection failed is recognised and never created twice.
 *
 * The server re-prices and re-validates every queued bill. A bill it refuses (an item removed from the menu, stock
 * already sold elsewhere, a permission change) is kept here as "failed" with the reason, for a person to retry or
 * discard; it is never silently dropped. The queue is per user and business, so bills are only sent under the
 * account that rang them up.
 */
const KEY_PREFIX = "cashflow-offline-bills:";
const LEGACY_KEY = "cashflow-lite-offline-client-events";
const UPDATED_EVENT = "cashflow-offline-queue-updated";
const MAX_QUEUED = 300;
const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let owner = null;
let replaying = null;

const storageKey = () => (owner ? `${KEY_PREFIX}${owner.businessId}:${owner.userId}` : null);
const emit = () => window.dispatchEvent(new CustomEvent(UPDATED_EVENT));

const read = () => {
  const key = storageKey();
  if (!key) return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

const write = (rows) => {
  const key = storageKey();
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(rows.slice(-MAX_QUEUED)));
  } catch {
    // Storage full or blocked: the in-memory checkout already reported the problem to the cashier.
  }
  emit();
};

export const OFFLINE_QUEUE_EVENT = UPDATED_EVENT;

export const setOfflineOwner = (user) => {
  owner = user?.id && user?.business_id ? { userId: user.id, businessId: user.business_id } : null;
  try {
    // The old queue only recorded events and never created bills; it is not replayed.
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
  emit();
};

export const getOfflineQueue = () => read();

/** True when a request failed because the server could not be reached (not because it refused the request). */
export const isNetworkFailure = (error) =>
  !error?.response && (
    error?.code === "ERR_NETWORK" ||
    error?.code === "ECONNABORTED" ||
    error?.message === "Network Error" ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  );

export const canQueueOffline = () => Boolean(storageKey());

export const queueOfflineBill = ({ payload, summary }) => {
  if (!storageKey()) throw new Error("Sign in again to bill offline");
  const rows = read();
  const id = payload.client_request_id;
  if (!id) throw new Error("A queued bill needs a checkout id");
  if (!rows.some((row) => row.id === id)) {
    rows.push({
      id,
      payload: { ...payload, offline_created_at: new Date().toISOString() },
      summary,
      status: "pending",
      attempts: 0,
      last_error: null,
      queued_at: new Date().toISOString(),
    });
    write(rows);
  }
  return id;
};

const errorMessage = (error) =>
  error?.response?.data?.error?.message || error?.response?.data?.detail || error?.message || "Rejected by the server";

const sendOne = (row) => axios.post(`${API_URL}/api/bills`, row.payload, { withCredentials: true, skipCache: true, timeout: 20000 });

export const replayOfflineQueue = async () => {
  if (replaying) return replaying;
  replaying = (async () => {
    let rows = read();
    const result = { replayed: 0, failed: 0, remaining: rows.length };
    if (!rows.length || (typeof navigator !== "undefined" && navigator.onLine === false)) return result;

    for (const row of rows.filter((entry) => entry.status === "pending")) {
      if (Date.now() - Date.parse(row.queued_at) > MAX_OFFLINE_AGE_MS) {
        rows = rows.map((entry) => (entry.id === row.id ? { ...entry, status: "failed", last_error: "Older than 7 days; review before sending" } : entry));
        result.failed += 1;
        continue;
      }
      try {
        await sendOne(row);
        rows = rows.filter((entry) => entry.id !== row.id);
        result.replayed += 1;
      } catch (error) {
        const status = error?.response?.status;
        if (isNetworkFailure(error) || status >= 500 || status === 429 || status === 401) {
          // Still unreachable, overloaded or signed out: keep it pending and stop for now.
          rows = rows.map((entry) => (entry.id === row.id ? { ...entry, attempts: entry.attempts + 1, last_error: errorMessage(error) } : entry));
          break;
        }
        rows = rows.map((entry) => (entry.id === row.id ? { ...entry, status: "failed", attempts: entry.attempts + 1, last_error: errorMessage(error) } : entry));
        result.failed += 1;
      }
    }
    write(rows);
    result.remaining = rows.length;
    return result;
  })().finally(() => {
    replaying = null;
  });
  return replaying;
};

export const retryOfflineBill = async (id) => {
  write(read().map((row) => (row.id === id ? { ...row, status: "pending", queued_at: new Date().toISOString() } : row)));
  return replayOfflineQueue();
};

export const discardOfflineBill = (id) => {
  write(read().filter((row) => !(row.id === id && row.status === "failed")));
};

/** Units of each product sold in bills that are still waiting to sync (pending or refused-for-review). */
export const getUnsyncedProductQuantities = () => {
  const totals = new Map();
  read().forEach((row) => {
    (row.payload?.items || []).forEach((item) => {
      const productId = item.id || item.productId || item.product_id;
      if (!productId) return;
      totals.set(productId, (totals.get(productId) || 0) + Math.max(0, Number(item.quantity) || 0));
    });
  });
  return totals;
};

/**
 * The server's stock does not yet include bills taken offline; subtracting them keeps this till from selling
 * units it has already sold.
 */
export const applyUnsyncedStock = (products) => {
  const unsynced = getUnsyncedProductQuantities();
  if (!unsynced.size || !Array.isArray(products)) return products;
  return products.map((product) => (unsynced.has(product.id)
    ? { ...product, stock: Math.max(0, Number(product.stock || 0) - unsynced.get(product.id)) }
    : product));
};
