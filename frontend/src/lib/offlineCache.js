/**
 * Offline copies of what the till needs to keep selling without a connection.
 *
 * - Session snapshot (sessionStorage): the signed-in user, kept per browser tab like the tab's own session id, so a
 *   reload in the same tab can continue offline. A new tab still needs the network to sign in.
 * - Data snapshots (localStorage): outlets and menu, scoped to business + user and removed at logout, so one
 *   person's data is never offered to another account on a shared till.
 *
 * Snapshots are only used when the server cannot be reached; whenever it answers, fresh data replaces them.
 */
const SESSION_KEY = "cashflow-offline-session";
const DATA_PREFIX = "cashflow-offline-data:";
export const OFFLINE_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_DATA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let scope = null;

const scopedPrefix = () => (scope ? `${DATA_PREFIX}${scope.businessId}:${scope.userId}:` : null);

export const setOfflineScope = (user) => {
  scope = user?.id && user?.business_id ? { userId: user.id, businessId: user.business_id } : null;
};

export const saveOfflineSession = (user) => {
  if (!user?.id) return;
  try {
    const { offline, ...stored } = user;
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: stored, savedAt: Date.now() }));
  } catch {
    // storage unavailable: the till simply needs the network after a reload
  }
};

export const loadOfflineSession = () => {
  try {
    const entry = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || "null");
    if (!entry?.user?.id || Date.now() - entry.savedAt > OFFLINE_SESSION_MAX_AGE_MS) return null;
    return entry;
  } catch {
    return null;
  }
};

export const clearOfflineSession = () => {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
};

export const saveOfflineData = (name, data) => {
  const prefix = scopedPrefix();
  if (!prefix) return;
  try {
    window.localStorage.setItem(`${prefix}${name}`, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Storage full: keep working online; the previous copy (if any) stays available.
  }
};

export const loadOfflineData = (name, maxAgeMs = OFFLINE_DATA_MAX_AGE_MS) => {
  const prefix = scopedPrefix();
  if (!prefix) return null;
  try {
    const entry = JSON.parse(window.localStorage.getItem(`${prefix}${name}`) || "null");
    if (!entry || Date.now() - entry.savedAt > maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
};

/** Removes every offline data copy of the current user (called at logout). Queued bills are kept separately. */
export const clearOfflineData = () => {
  const prefix = scopedPrefix();
  if (!prefix) return;
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
};

/** True when a request failed because nothing answered (as opposed to the server refusing it). */
export const isUnreachable = (error) =>
  error?.code !== "ERR_CANCELED" && !error?.response && (
    error?.code === "ERR_NETWORK" ||
    error?.code === "ECONNABORTED" ||
    error?.message === "Network Error" ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  );
