// Staff and public menu requests share the configured backend.
export const resolveApiBaseUrl = (configured = "", pageOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin) => {
  const value = String(configured || "").trim().replace(/\/+$/, "");
  const page = new URL(pageOrigin);
  const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const lan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(page.hostname);
  if (value) {
    const api = new URL(value, pageOrigin);
    if (lan && loopback(api.hostname)) return ""; // Phones use the local /api proxy.
    return api.href.replace(/\/$/, "");
  }
  if (lan) return "";
  if (loopback(page.hostname)) return `${page.protocol}//${page.hostname}:4001`;
  // Public deployments must configure a backend or /api proxy. Never silently
  // contact a hardcoded, potentially unrelated cloud service.
  return "";
};
export const API_URL = resolveApiBaseUrl(process.env.REACT_APP_BACKEND_URL);
