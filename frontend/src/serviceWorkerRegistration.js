// Registers the offline app-shell service worker in production builds only.
export const SW_UPDATE_EVENT = "cashflow-app-update-ready";

let waitingWorker = null;

const announceUpdate = (worker) => {
  waitingWorker = worker;
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
};

export const hasWaitingUpdate = () => Boolean(waitingWorker);

/** Activate the downloaded version and reload once it has taken over. */
export const applyAppUpdate = () => {
  if (!waitingWorker) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
};

export const registerServiceWorker = () => {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/service-worker.js`);
      if (registration.waiting && navigator.serviceWorker.controller) announceUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          // Only an update (a page already controlled by an older version) needs the cashier's go-ahead.
          if (installing.state === "installed" && navigator.serviceWorker.controller) announceUpdate(installing);
        });
      });
      // Tills stay open for days; look for new versions every hour.
      window.setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    } catch (error) {
      console.error("Offline support could not be enabled:", error);
    }
  });
};
