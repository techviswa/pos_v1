import { useEffect, useEffectEvent, useRef } from "react";
import { subscribeLiveUpdates } from "../lib/liveUpdates";

export const useAutoRefresh = (refreshFn, options = {}) => {
  const {
    enabled = true,
    intervalMs = 0,
    focusThrottleMs = 30000,
    refreshOnFocus = false,
    refreshOnVisibility = false,
    pauseWhenHidden = true,
    // Server change events that should trigger a refresh, e.g. ["kot", "orders"]. Empty: no live updates.
    liveResources = [],
  } = options;
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const liveKey = [...liveResources].sort().join(",");
  const lastRefreshAtRef = useRef(0);

  const runRefresh = useEffectEvent((queueIfBusy = false) => {
    if (!enabled) {
      return;
    }
    if (inFlightRef.current) {
      // Only a live change arriving mid-refresh earns a follow-up run; other callers are dropped as before, so a
      // re-render can never chain refreshes into a loop.
      if (queueIfBusy) pendingRef.current = true;
      return;
    }

    inFlightRef.current = true;
    lastRefreshAtRef.current = Date.now();

    Promise.resolve(refreshFn())
      .catch((error) => {
        // Prevent background refresh failures from surfacing as uncaught runtime errors.
        console.error("Auto refresh failed:", error);
      })
      .finally(() => {
        inFlightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          runRefresh();
        }
      });
  });

  // The live subscription reads the latest refresh function through a ref, so it is created once per screen
  // instead of being torn down and re-opened on every render.
  const runRefreshRef = useRef(runRefresh);
  useEffect(() => {
    runRefreshRef.current = runRefresh;
  });

  useEffect(() => {
    if (!enabled || !liveKey) {
      return undefined;
    }
    const wanted = new Set(liveKey.split(","));
    let debounce = null;
    const unsubscribe = subscribeLiveUpdates((event) => {
      if (event?.resource !== "*" && !wanted.has(event?.resource)) return;
      window.clearTimeout(debounce);
      // Bursts (e.g. a bill that also moves stock and the kitchen) collapse into one refresh.
      debounce = window.setTimeout(() => runRefreshRef.current(true), 250);
    });
    return () => {
      window.clearTimeout(debounce);
      unsubscribe();
    };
  }, [enabled, liveKey]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    runRefresh();

    const safeRefresh = () => {
      if (pauseWhenHidden && document.visibilityState !== "visible") {
        return;
      }

      const now = Date.now();
      if (now - lastRefreshAtRef.current < focusThrottleMs) {
        return;
      }

      runRefresh();
    };

    const handleFocus = () => safeRefresh();
    const handleVisibility = () => {
      if (refreshOnVisibility && document.visibilityState === "visible") {
        safeRefresh();
      }
    };
    const timer =
      intervalMs > 0
        ? window.setInterval(() => {
            if (!pauseWhenHidden || document.visibilityState === "visible") {
              safeRefresh();
            }
          }, intervalMs)
        : null;

    if (refreshOnFocus) {
      window.addEventListener("focus", handleFocus);
    }
    if (refreshOnVisibility) {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      if (timer) {
        window.clearInterval(timer);
      }
      if (refreshOnFocus) {
        window.removeEventListener("focus", handleFocus);
      }
      if (refreshOnVisibility) {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [enabled, intervalMs, focusThrottleMs, pauseWhenHidden, refreshOnFocus, refreshOnVisibility, runRefresh]);
};
