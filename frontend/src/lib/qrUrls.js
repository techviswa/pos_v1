import { resolveApiBaseUrl } from "./apiUrl";
const isLoopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
const isLan = (host) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
let runtimeConnection = null;
export const setQrConnection = (connection) => { runtimeConnection = connection; };

export const resolveQrApiBaseUrl = (configured = "", pageOrigin = window.location.origin) => resolveApiBaseUrl(configured, pageOrigin);

/** True when guests can only reach this QR link from the same network as the POS (localhost or a LAN address). */
export const isLocalNetworkUrl = (url) => {
  try { const { hostname } = new URL(url); return isLoopback(hostname) || isLan(hostname); } catch { return false; }
};

export const getPublicQrUrl =(token, configured = process.env.REACT_APP_PUBLIC_FRONTEND_URL, pageOrigin = window.location.origin) => {
  const page = new URL(pageOrigin);
  const base = new URL(runtimeConnection?.public_frontend_url || configured || pageOrigin);
  // Opening POS through its current LAN address also corrects stale local QR hosts.
  if (isLan(page.hostname) && (isLan(base.hostname) || isLoopback(base.hostname))) base.host = page.host;
  return `${base.href.replace(/\/$/, "")}/qr/${encodeURIComponent(token)}`;
};

/** The printed address of a smart code (menu, offer, review, card, link): /q/<token>. */
export const getSmartQrUrl = (token, configured, pageOrigin) => getPublicQrUrl(token, configured, pageOrigin).replace(/\/qr\/([^/]+)$/, "/q/$1");
