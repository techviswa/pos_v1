// Keep only this browser's tracking capabilities, scoped to one seating.
const read = (key, fallback) => {
  try { return JSON.parse(sessionStorage.getItem(key)) || fallback; } catch { return fallback; }
};
export const visitKey = (token, session) => `qr-visit:${token}:${session?.id}:${session?.opened_at}`;
export const visitOrders = (key) => read(key, []);
export function rememberOrder(key, token, order) {
  if (!order?.tracking_token) return [];
  const orders = [{ id: order.id, tracking_token: order.tracking_token }, ...visitOrders(key).filter((item) => item.id !== order.id)].slice(0, 30);
  try {
    sessionStorage.setItem(key, JSON.stringify(orders));
    sessionStorage.setItem(`qr-return:${order.tracking_token}`, JSON.stringify(token));
  } catch { /* Ordering still works when browser storage is disabled. */ }
  return orders;
}
export const returnMenuToken = (trackingToken) => read(`qr-return:${trackingToken}`, null);
export function pendingRequest(key, signature, createKey) {
  const saved = read(`${key}:pending`, null);
  if (saved?.signature === signature && saved?.key) return saved;
  const request = { signature, key: createKey() };
  try { sessionStorage.setItem(`${key}:pending`, JSON.stringify(request)); } catch { /* Memory fallback in caller. */ }
  return request;
}
export function clearPendingRequest(key) {
  try { sessionStorage.removeItem(`${key}:pending`); } catch { /* Optional storage. */ }
}
