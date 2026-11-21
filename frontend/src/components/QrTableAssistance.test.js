import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrTableAssistance } from "./QrTableAssistance";
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../lib/qrUrls", () => ({ resolveQrApiBaseUrl: () => "http://phone-host:4001" }));
let element, root, rows;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers(); rows = [];
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  axios.get.mockReset(); axios.post.mockReset();
  axios.get.mockImplementation(() => Promise.resolve({ data: { success: true, data: rows } }));
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); jest.useRealTimers(); });
const render = () => act(async () => root.render(<QrTableAssistance token="table-token" sessionKey="table-session" />));
const button = (label) => [...element.querySelectorAll("button")].find((node) => node.textContent === label);
test("camera-opened menu sends one table-scoped call and follows accepted/completed status without staff authentication", async () => {
  axios.post.mockResolvedValue({ data: { success: true, data: { duplicate: false, request: { id: "request", kind: "waiter", label: "Call waiter", status: "pending" } } } });
  await render();
  await act(async () => button("Call waiter").click());
  expect(axios.post).toHaveBeenCalledWith("http://phone-host:4001/api/public/qr/table-token/assistance", { session_key: "table-session", kind: "waiter", note: "" });
  expect(button("Waiter requested").disabled).toBe(true);
  rows = [{ id: "request", kind: "waiter", label: "Call waiter", status: "accepted" }];
  await act(async () => jest.advanceTimersByTime(5000));
  expect(element.textContent).toContain("Someone is coming");
  rows = [{ ...rows[0], status: "resolved" }];
  await act(async () => jest.advanceTimersByTime(5000));
  expect(element.textContent).toContain("Completed");
  expect(button("Call waiter").disabled).toBe(false);
  expect(axios.get.mock.calls.every(([url]) => !url.includes("/auth/"))).toBe(true);
});
test("request bill records payment preference without calling a payment endpoint", async () => {
  axios.post.mockResolvedValue({ data: { success: true, data: { request: { id: "bill", kind: "bill", label: "Request bill", status: "pending" } } } });
  await render(); await act(async () => button("Request bill").click());
  await act(async () => { const select = element.querySelector("select"); select.value = "upi"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => element.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining("/assistance"), expect.objectContaining({ kind: "bill", payment_method: "upi", session_key: "table-session" }));
  expect(axios.post.mock.calls).toHaveLength(1);
});

test("already-unwrapped guest responses keep the accepted request visible", async () => {
  axios.get.mockResolvedValue({ data: [] });
  axios.post.mockResolvedValue({ data: { request: { id: "flat", kind: "waiter", label: "Call waiter", status: "accepted" } } });
  await render(); await act(async () => button("Call waiter").click());
  expect(element.textContent).toContain("Someone is coming");
  expect(button("Waiter requested").disabled).toBe(true);
  expect(element.querySelector('[role="alert"]')).toBeNull();
});
test("a failed call is visible and can be retried", async () => {
  axios.post.mockRejectedValue(new Error("Network unavailable")); await render();
  await act(async () => button("Call waiter").click());
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
  expect(button("Call waiter").disabled).toBe(false);
});
