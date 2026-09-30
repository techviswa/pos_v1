import {
  clearOfflineData,
  clearOfflineSession,
  isUnreachable,
  loadOfflineData,
  loadOfflineSession,
  OFFLINE_SESSION_MAX_AGE_MS,
  saveOfflineData,
  saveOfflineSession,
  setOfflineScope,
} from "./offlineCache";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setOfflineScope({ id: "u1", business_id: "b1" });
});

test("the signed-in user is kept for this tab only, and expires", () => {
  saveOfflineSession({ id: "u1", business_id: "b1", role: "Cashier", offline: true });
  expect(loadOfflineSession().user).toEqual({ id: "u1", business_id: "b1", role: "Cashier" });
  expect(localStorage.length).toBe(0);
  const stored = JSON.parse(sessionStorage.getItem("cashflow-offline-session"));
  sessionStorage.setItem("cashflow-offline-session", JSON.stringify({ ...stored, savedAt: Date.now() - OFFLINE_SESSION_MAX_AGE_MS - 1 }));
  expect(loadOfflineSession()).toBeNull();
  clearOfflineSession();
  expect(sessionStorage.getItem("cashflow-offline-session")).toBeNull();
});

test("data copies belong to one user and are wiped at logout", () => {
  saveOfflineData("outlets", [{ id: "o1" }]);
  expect(loadOfflineData("outlets").data).toEqual([{ id: "o1" }]);
  setOfflineScope({ id: "u2", business_id: "b1" });
  expect(loadOfflineData("outlets")).toBeNull();
  setOfflineScope({ id: "u1", business_id: "b1" });
  clearOfflineData();
  expect(loadOfflineData("outlets")).toBeNull();
});

test("only a missing connection counts as offline", () => {
  expect(isUnreachable({ code: "ERR_NETWORK", message: "Network Error" })).toBe(true);
  expect(isUnreachable({ response: { status: 500 } })).toBe(false);
  expect(isUnreachable({ code: "ERR_CANCELED" })).toBe(false);
});
