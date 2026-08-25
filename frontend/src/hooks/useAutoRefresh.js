import { useEffect, useEffectEvent, useRef } from "react";

export const useAutoRefresh = (refreshFn, options = {}) => {
  const {
    enabled = true,
    intervalMs = 0,
    focusThrottleMs = 30000,
    refreshOnFocus = false,
    refreshOnVisibility = false,
    pauseWhenHidden = true,
  } = options;
  const inFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  const runRefresh = useEffectEvent(() => {
    if (!enabled || inFlightRef.current) {
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
      });
  });

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
