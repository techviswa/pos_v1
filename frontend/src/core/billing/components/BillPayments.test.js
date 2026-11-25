import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { BillPayments } from "./BillPayments";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });

const setValue = (input, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};
const button = (text) => [...element.querySelectorAll("button")].find((node) => node.textContent.startsWith(text));
const unpaid = { id: "bill-1", total: 400, paid_amount: 0, payments: [], refunds: [], status: "completed" };

test("an unpaid bill shows what is owed and records a cash payment once per form", async () => {
  const onChanged = jest.fn();
  axios.post.mockResolvedValue({ data: { success: true, data: { ...unpaid, id: "bill-1", paid_amount: 400 } } });
  await act(async () => root.render(<BillPayments apiUrl="" bill={unpaid} canCollect onChanged={onChanged} />));
  expect(element.querySelector('[data-testid="bill-balance"]').textContent).toContain("400");
  await act(async () => button("Collect payment").click());
  await act(async () => element.querySelector('[data-testid="collect-form"]').requestSubmit());
  const [url, body] = axios.post.mock.calls[0];
  expect(url).toBe("/api/billing/bill-1/payments");
  expect(body).toEqual(expect.objectContaining({ amount: 400, method: "Cash", client_request_id: expect.any(String) }));
  expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ paid_amount: 400 }));
});

test("a UPI payment waiting for confirmation can be confirmed by a manager with its reference", async () => {
  const bill = { ...unpaid, payments: [{ id: "pay-1", method: "UPI", amount: 400, status: "pending_confirmation" }] };
  axios.post.mockResolvedValue({ data: { ...bill } });
  await act(async () => root.render(<BillPayments apiUrl="" bill={bill} canCollect canConfirm />));
  expect(button("Collect payment")).toBeUndefined();
  await act(async () => button("Confirm").click());
  await act(async () => setValue(element.querySelector('[aria-label="Transaction reference"]'), "UPI123"));
  await act(async () => element.querySelector('[data-testid="confirm-payment-form"]').requestSubmit());
  expect(axios.post).toHaveBeenCalledWith("/api/billing/bill-1/payments/pay-1/confirm", { reference: "UPI123" }, { withCredentials: true });
});

test("staff without billing rights and paid bills get no collect button", async () => {
  await act(async () => root.render(<BillPayments apiUrl="" bill={unpaid} />));
  expect(button("Collect payment")).toBeUndefined();
  await act(async () => root.render(<BillPayments apiUrl="" bill={{ ...unpaid, payments: [{ id: "p", method: "Cash", amount: 400, status: "confirmed" }] }} canCollect />));
  expect(button("Collect payment")).toBeUndefined();
  expect(element.querySelector('[data-testid="bill-balance"]')).toBeNull();
});

test("a wrong bill is voided in two steps: staff request with a reason, a manager approves", async () => {
  const prompt = jest.spyOn(window, "prompt").mockReturnValue("Entered twice");
  axios.post.mockResolvedValue({ data: { ...unpaid, void_status: "pending_approval", void_reason: "Entered twice" } });
  try {
    await act(async () => root.render(<BillPayments apiUrl="" bill={unpaid} canCollect />));
    await act(async () => button("Request void").click());
    expect(axios.post).toHaveBeenCalledWith("/api/billing/bill-1/void-request", { reason: "Entered twice" }, { withCredentials: true });
    await act(async () => root.render(<BillPayments apiUrl="" bill={{ ...unpaid, void_status: "pending_approval", void_reason: "Entered twice" }} canCollect canConfirm />));
    expect(element.querySelector('[data-testid="void-pending"]').textContent).toContain("Entered twice");
    await act(async () => button("Approve void").click());
    expect(axios.post).toHaveBeenLastCalledWith("/api/billing/bill-1/void-approval", { approved: true }, { withCredentials: true });
    await act(async () => root.render(<BillPayments apiUrl="" bill={{ ...unpaid, status: "void", void_reason: "Entered twice" }} canCollect canConfirm />));
    expect(element.textContent).toContain("This bill is voided: Entered twice");
    expect(button("Collect payment")).toBeUndefined();
  } finally { prompt.mockRestore(); }
});
