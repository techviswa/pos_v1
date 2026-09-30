/* eslint-disable no-restricted-globals */
// Keeps the POS app itself (HTML, JS, CSS) available with no connection, so a till can be reloaded offline.
// It deliberately caches no API responses: business data offline comes from the app's own per-user copies,
// which are cleared at logout, so nothing from one account is ever served to another on a shared till.
import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

clientsClaim();

// The build step injects the list of every built file (including lazily loaded screens).
precacheAndRoute(self.__WB_MANIFEST);

// Any in-app URL (e.g. /billing) opens the cached app shell; API calls and real files are never intercepted here.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${process.env.PUBLIC_URL}/index.html`), {
    denylist: [/^\/api\//, /^\/health/, /\/[^/?]+\.[^/]+$/],
  }),
);

// A new version waits until the cashier chooses to reload (never in the middle of a sale).
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
