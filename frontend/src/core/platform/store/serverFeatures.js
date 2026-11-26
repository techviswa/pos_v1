import axios from "axios";
import { useSyncExternalStore } from "react";
import { API_URL } from "../../../lib/apiUrl";
import { apiData } from "../../../lib/apiData";

// The server decides which plan features a business has (GET /api/features). The app's own template only says what a
// restaurant could use, so a screen whose feature the server switched off (e.g. kitchen tickets on Starter) must not be
// offered: it would only show "Error 403". Until the answer arrives (or when offline) the template decides.

// App feature key -> server feature key.
export const SERVER_FEATURE_KEYS = { kot: "kot", tables: "table-management", barcode: "barcode", batch_tracking: "batch-tracking" };

let state = { owner: "", disabled: null, enabled: null };
const listeners = new Set();
const publish = (next) => { state = next; listeners.forEach((listener) => listener()); };
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

/** Called by the auth provider whenever the signed-in user or business changes ("" when signed out). */
export const setFeatureOwner = async (owner) => {
  if (owner === state.owner) return;
  publish({ owner, disabled: null, enabled: null });
  if (!owner) return;
  try {
    const data = apiData(await axios.get(`${API_URL}/api/features`, { withCredentials: true }));
    const items = Array.isArray(data?.items) ? data.items : [];
    if (state.owner === owner) publish({ owner, disabled: new Set(items.filter((item) => item?.enabled === false).map((item) => item.key)), enabled: new Set(items.filter((item) => item?.enabled === true).map((item) => item.key)) });
  } catch {
    // Offline or not signed in yet: keep the template's answer rather than hiding screens.
  }
};

export const isDisabledByServer = (disabled, featureKey) => Boolean(disabled && SERVER_FEATURE_KEYS[featureKey] && disabled.has(SERVER_FEATURE_KEYS[featureKey]));

export const useServerDisabledFeatures = () => useSyncExternalStore(subscribe, () => state.disabled, () => null);

/** True only when the server confirms the plan includes this feature (server key, e.g. "barcode"). Plan-only
 * features such as barcodes and batch tracking stay hidden until then, and offline. */
const enabledSnapshot = () => state.enabled;
export const useServerFeatureEnabled = (serverKey) => Boolean(useSyncExternalStore(subscribe, enabledSnapshot, () => null)?.has(serverKey));
