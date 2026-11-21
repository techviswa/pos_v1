import { visitKey, visitOrders, rememberOrder, returnMenuToken, pendingRequest, clearPendingRequest } from "./qrVisit";

beforeEach(() => sessionStorage.clear());
test("round links survive navigation, deduplicate retries and remain scoped to a seating", () => {
  const key = visitKey("qr", { id: "s", opened_at: "first" });
  const order = { id: "one", tracking_token: "secret" };
  rememberOrder(key, "qr", order);
  rememberOrder(key, "qr", order);
  expect(visitOrders(key)).toEqual([order]);
  expect(returnMenuToken("secret")).toBe("qr");
  expect(visitOrders(visitKey("qr", { id: "s", opened_at: "second" }))).toEqual([]);
  expect(visitOrders(visitKey("other-qr", { id: "s", opened_at: "first" }))).toEqual([]);
});
test("corrupted storage does not stop menu rendering", () => {
  sessionStorage.setItem("broken", "{");
  expect(visitOrders("broken")).toEqual([]);
});
test("uncertain submissions reuse a key after reload; a new round gets a fresh key", () => {
  let sequence = 0;
  const create = () => String(++sequence);
  expect(pendingRequest("visit", "cart", create).key).toBe("1");
  expect(pendingRequest("visit", "cart", create).key).toBe("1");
  clearPendingRequest("visit");
  expect(pendingRequest("visit", "cart", create).key).toBe("2");
  expect(pendingRequest("visit", "different-cart", create).key).toBe("3");
});
