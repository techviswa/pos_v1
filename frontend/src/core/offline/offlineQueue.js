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
const UPDATED_EVENT = "cashflow-offline-queue-updated";
const MAX_QUEUED = 300;
const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let owner = null;
const replaying = new Map();
const storageErrors = new Map();
const terminal = new Set(["synced", "discarded"]);
const storageKey = () => (owner ? `${KEY_PREFIX}${owner.businessId}:${owner.userId}` : null);
const entryKey = (key, id) => `${key}:receipt:${encodeURIComponent(id)}`;
const emit = () => window.dispatchEvent(new CustomEvent(UPDATED_EVENT));
const storageFailure = (key, kind) => {
  const message = kind === 'read' ? 'Saved offline receipts cannot be read. Recover the saved copy before continuing.'
    : 'This device could not save the offline receipt. Keep the cart open and recover device storage before continuing.';
  storageErrors.set(key, { kind, message });
  return new Error(message);
};

// Each receipt has its own durable key. An acknowledgement never overwrites a
// receipt another tab or checkout added while its network request was in flight.
const read = (key = storageKey(), strict = false) => {
  if (!key) return [];
  try {
    const legacy = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (!Array.isArray(legacy)) throw new Error('Invalid saved queue');
    const rows = new Map();
    for (const row of legacy) {
      if (!row || typeof row.id !== 'string' || !row.payload) throw new Error('Invalid saved receipt');
      rows.set(row.id, row);
    }
    const prefix = `${key}:receipt:`;
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
      .filter(value => value?.startsWith(prefix));
    for (const itemKey of keys) {
      const raw = window.localStorage.getItem(itemKey);
      if (raw === null) continue;
      const row = JSON.parse(raw);
      if (!row || typeof row.id !== 'string' || (!terminal.has(row.status) && !row.payload)) throw new Error('Invalid saved receipt');
      rows.set(row.id, row);
    }
    if (storageErrors.get(key)?.kind === 'read') storageErrors.delete(key);
    return [...rows.values()].filter(row => !terminal.has(row.status))
      .sort((a, b) => String(a.queued_at || '').localeCompare(String(b.queued_at || '')) || a.id.localeCompare(b.id));
  } catch {
    const error = storageFailure(key, 'read');
    if (strict) throw error;
    return [];
  }
};

const store = (key, row) => {
  if (!key) throw new Error('Sign in again to save offline receipts');
  try {
    const value = terminal.has(row.status) ? { id: row.id, status: row.status, completed_at: new Date().toISOString() } : row;
    window.localStorage.setItem(entryKey(key, row.id), JSON.stringify(value));
    storageErrors.delete(key);
  } catch { const error = storageFailure(key, 'write'); emit(); throw error; }
  emit();
};
const updateSaved = (key, id, update) => {
  const current = read(key, true).find(row => row.id === id);
  if (current) store(key, update(current));
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => key !== 'offline_created_at').map(key => [key, canonical(value[key])])) : value;

export const getOfflineStorageError = () => storageErrors.get(storageKey())?.message || '';
export const getOfflineRecoveryCopy = () => {
  const key = storageKey();
  if (!key) throw new Error('Sign in to recover this account?s offline receipts');
  const copies = {};
  for (let index = 0; index < window.localStorage.length; index++) {
    const itemKey = window.localStorage.key(index);
    if (itemKey === key || itemKey?.startsWith(`${key}:receipt:`)) copies[itemKey] = window.localStorage.getItem(itemKey);
  }
  return JSON.stringify({ recovered_at: new Date().toISOString(), copies }, null, 2);
};

export const OFFLINE_QUEUE_EVENT = UPDATED_EVENT;

export const setOfflineOwner = (user) => {
  owner = user?.id && user?.business_id ? { userId: user.id, businessId: user.business_id } : null;
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
  const key = storageKey(), rows = read(key, true);
  const id = payload.client_request_id;
  if (typeof id !== 'string' || !id || id.length > 512) throw new Error("A queued bill needs a valid checkout id");
  const existing = rows.find(row => row.id === id);
  if (existing && JSON.stringify(canonical(existing.payload)) !== JSON.stringify(canonical(payload))) throw new Error('This checkout ID already belongs to a different saved receipt. Start a new checkout.');
  if (!existing) {
    if (window.localStorage.getItem(entryKey(key, id))) throw new Error('This checkout was already completed. Start a new checkout.');
    if (rows.length >= MAX_QUEUED) throw new Error('This device has 300 unsynced receipts. Sync or review them before taking another offline bill.');
    store(key, {
      id,
      payload: { ...payload, offline_created_at: new Date().toISOString() },
      summary,
      status: "pending",
      attempts: 0,
      last_error: null,
      queued_at: new Date().toISOString(),
    });
  }
  return id;
};

const errorMessage = (error) =>
  error?.response?.data?.error?.message || error?.response?.data?.detail || error?.message || "Rejected by the server";

const sendOne = (row) => axios.post(`${API_URL}/api/bills`, row.payload, { withCredentials: true, skipCache: true, timeout: 20000 });

export const replayOfflineQueue = async () => {
  const key = storageKey();
  if (!key) return { replayed: 0, failed: 0, remaining: 0 };
  if (replaying.has(key)) return replaying.get(key);
  const work = (async () => {
    const rows = read(key, true);
    const result = { replayed: 0, failed: 0, remaining: rows.length };
    if (!rows.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return result;
    for (const queued of rows.filter(entry => entry.status === 'pending')) {
      // A different login must never send this account's receipts under its session.
      if (storageKey() !== key) break;
      const row = read(key, true).find(entry => entry.id === queued.id);
      if (!row || row.status !== 'pending') continue;
      if (!Number.isFinite(Date.parse(row.queued_at)) || Date.now() - Date.parse(row.queued_at) > MAX_OFFLINE_AGE_MS) {
        updateSaved(key, row.id, current => ({ ...current, status: 'failed', last_error: 'Older than 7 days or invalid date; review before sending' }));
        result.failed += 1;
        continue;
      }
      try {
        await sendOne(row);
      } catch (error) {
        const status = error?.response?.status;
        const retryable = isNetworkFailure(error) || status >= 500 || status === 429 || status === 401;
        updateSaved(key, row.id, current => ({ ...current, status: retryable ? 'pending' : 'failed',
          attempts: (current.attempts || 0) + 1, last_error: errorMessage(error) }));
        if (retryable) break;
        result.failed += 1;
        continue;
      }
      // If persisting the acknowledgement fails, keep the saved receipt. Its
      // immutable checkout ID makes a later replay safe even after a reload.
      store(key, { id: row.id, status: 'synced' });
      result.replayed += 1;
    }
    result.remaining = read(key, true).length;
    return result;
  })().finally(() => replaying.delete(key));
  replaying.set(key, work);
  return work;
};

export const retryOfflineBill = async (id) => {
  const key = storageKey();
  updateSaved(key, id, row => row.status === 'failed' ? { ...row, status: 'pending', queued_at: new Date().toISOString() } : row);
  return replayOfflineQueue();
};

export const discardOfflineBill = (id) => {
  const key = storageKey();
  const row = read(key, true).find(entry => entry.id === id);
  if (row?.status === 'failed') store(key, { id, status: 'discarded' });
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
