import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrCheckout, splitAmounts } from "./QrCheckout";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../lib/qrUrls", () => ({ resolveQrApiBaseUrl: () => "http://api" }));
jest.mock("../lib/pos", () => ({ formatCurrency: (value) => `Rs ${value}`, newClientKey: () => "request-key" }));

const response = (data) => ({ data: { data } });
let element, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); jest.clearAllMocks();
  element = document.createElement("div"); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); });
const button = (text) => [...element.querySelectorAll("button")].find((node) => node.textContent === text);
const change = async (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
test("equal shares retain every paise", () => {
  expect(splitAmounts(10, 3)).toEqual([3.34, 3.33, 3.33]);
  expect(splitAmounts(0.01, 3)).toEqual([0.01, 0, 0]);
});

test("a split order switches invoices and binds payment to the selected invoice", async () => {
  const invoices = [{ id: "a", number: "A", due_amount: 100 }, { id: "b", number: "B", due_amount: 200 }];
  axios.get.mockImplementation(async (_, options) => {
    const chosen = options.params.bill_id === "b" ? invoices[1] : invoices[0];
    return response({ invoices, bill: { ...chosen, status: "issued", total: chosen.due_amount, paid_amount: 0 }, online_enabled: true });
  });
  axios.post.mockResolvedValue(response({ status: "pending" }));
  await act(async () => root.render(<QrCheckout trackingToken="tracking" />));
  const select = element.querySelector("select");
  await act(async () => { select.value = "b"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(element.textContent).toContain("Invoice B");
  await act(async () => button("Create secure payment link").click());
  expect(axios.post.mock.calls[0][1].bill_id).toBe("b");
  expect(axios.post.mock.calls[0][1].amount).toBe(200);
});
test("the guest reviews issued totals and payment remains pending until gateway confirmation", async () => {
  const bill = { id: "bill", number: "CF-1", status: "issued", subtotal: 100, tax: 18, total: 118, paid_amount: 0, due_amount: 118 };
  let snapshot = { bill, online_enabled: true };
  axios.get.mockImplementation(async () => response(snapshot));
  axios.post.mockImplementation(async (path) => {
    if (path.endsWith("/pay")) {
      snapshot = { ...snapshot, active_payment: { id: "intent", amount: 59, url: "https://rzp.io/i/test", status: "pending" } };
      return response(snapshot.active_payment);
    }
    snapshot = { bill: { ...bill, paid_amount: 59, due_amount: 59 }, online_enabled: true };
    return response({ id: "intent", status: "confirmed" });
  });
  await act(async () => root.render(<QrCheckout trackingToken="tracking" />));
  expect(element.textContent).toContain("Invoice CF-1");
  expect(element.textContent).not.toContain("Bill paid.");
  await change(element.querySelector('input[type="number"]'), "119");
  expect(button("Create secure payment link").disabled).toBe(true);
  await change(element.querySelector('input[type="number"]'), "59");
  await act(async () => button("Create secure payment link").click());
  expect(axios.post.mock.calls[0][1]).toEqual({ amount: 59, client_request_id: "request-key", bill_id: "bill" });
  expect(element.textContent).toContain("Payment in progress: Rs 59");
  expect(element.textContent).not.toContain("Bill paid.");
  expect(element.querySelector("a").getAttribute("href")).toBe("https://rzp.io/i/test");
  await act(async () => button("Check payment status").click());
  expect(element.textContent).not.toContain("Payment in progress");
  expect(element.textContent).toContain("RemainingRs 59");
});
test("phone verification precedes loyalty balance access and a points request", async () => {
  axios.get.mockResolvedValue(response({ bill: null, requested: false }));
  axios.post.mockImplementation(async (path) => path.endsWith("/code") ? response({ verification_token: "verify" }) : path.endsWith("/verify") ? response({ points: 200, rules: { enabled: true, point_value: 1, earn_percent: 5, min_redeem_points: 100, max_redeem_percent: 50 } }) : response({ requested: true }));
  await act(async () => root.render(<QrCheckout trackingToken="tracking" />));
  expect(element.textContent).not.toContain("Available points:");
  await act(async () => button("Send verification code").click());
  await change(element.querySelector('input[maxlength="6"]'), "123456");
  await act(async () => button("Verify phone").click());
  expect(element.textContent).toContain("Available points: 200");
  await change(element.querySelector('input[type="number"]'), "100");
  await act(async () => button("Request final bill").click());
  expect(axios.post.mock.calls.at(-1)[1]).toEqual({ points: 100, verification_token: "verify" });
});
test("unconfigured online payments direct the guest to staff", async () => {
  axios.get.mockResolvedValue(response({ bill: { id: "bill", status: "issued", total: 10, due_amount: 10 }, online_enabled: false }));
  await act(async () => root.render(<QrCheckout trackingToken="tracking" />));
  expect(element.textContent).toContain("Online payment is not enabled");
  expect(button("Create secure payment link")).toBeUndefined();
});
