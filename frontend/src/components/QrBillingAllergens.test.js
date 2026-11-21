import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrVisitBilling } from "./QrVisitBilling";
import { IngredientAllergens } from "./IngredientAllergens";
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));
jest.mock("../contexts/AuthContext", () => ({ API_URL: "http://api" }));
jest.mock("../lib/pos", () => ({ formatCurrency: (n) => `Rs ${n}`, newClientKey: () => "durable-request-key" }));
const response = (data) => ({ data: { success: true, data } });
let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
const click = async (text) => act(async () => [...element.querySelectorAll("button")].find((node) => node.textContent === text).click());
const input = async (node, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
});
test("round combining keeps persisted item identifiers and retry keys after a lost response", async () => {
  axios.get.mockResolvedValue(response({ orders: [
    { id: "one", customer_name: "Guest", created_at: "2026-10-25T00:00:00Z", items: [{ id: "line1", name: "Meal", quantity: 2, price: 100 }] },
    { id: "two", customer_name: "Guest", created_at: "2026-10-25T00:01:00Z", items: [{ id: "line2", name: "Drink", quantity: 1, price: 30 }] },
  ] }));
  axios.post.mockRejectedValueOnce(new Error("lost response")).mockResolvedValue(response({ bill_ids: ["bill"] }));
  const issued = jest.fn();
  await act(async () => root.render(<QrVisitBilling orderId="one" onClose={() => {}} onIssued={issued} />));
  await click("Issue one combined unpaid invoice");
  expect(issued).not.toHaveBeenCalled();
  await click("Issue one combined unpaid invoice");
  expect(axios.post.mock.calls[0][1]).toEqual(axios.post.mock.calls[1][1]);
  expect(axios.post.mock.calls[0][1].groups).toEqual([{ items: [{ item_id: "line1", quantity: 2 }, { item_id: "line2", quantity: 1 }] }]);
  expect(issued).toHaveBeenCalledTimes(1);
});
test("item splitting refuses incomplete assignment and sends exact quantities to separate invoices", async () => {
  axios.get.mockResolvedValue(response({ orders: [{ id: "one", customer_name: "Guest", created_at: "2026-10-25T00:00:00Z", items: [{ id: "line", name: "Meal", quantity: 3, price: 100 }] }] }));
  axios.post.mockResolvedValue(response({ bill_ids: ["a", "b"] }));
  await act(async () => root.render(<QrVisitBilling orderId="one" onClose={() => {}} onIssued={() => {}} />));
  const fields = element.querySelectorAll('input[type="number"]');
  await input(fields[0], "1");
  expect([...element.querySelectorAll("button")].find((button) => button.textContent === "Issue separate unpaid invoices").disabled).toBe(true);
  await input(fields[1], "2"); await click("Issue separate unpaid invoices");
  expect(axios.post.mock.calls[0][1].groups).toEqual([{ items: [{ item_id: "line", quantity: 1 }] }, { items: [{ item_id: "line", quantity: 2 }] }]);
});
test("changing an ingredient warning resets review until staff explicitly verify it again", async () => {
  axios.get.mockResolvedValue(response([{ id: "milk", name: "Milk", allergens: ["Milk"], may_contain: [], reviewed: true }]));
  axios.put.mockImplementation(async (_, data) => response(data));
  await act(async () => root.render(<IngredientAllergens apiUrl="http://api" />));
  await click("Manage ingredient allergens"); await click("Edit allergens");
  await input(element.querySelector("fieldset input"), "Milk,Soy");
  expect(element.querySelector('fieldset input[type="checkbox"]').checked).toBe(false);
  await act(async () => element.querySelector('fieldset input[type="checkbox"]').click());
  await click("Save ingredient allergens");
  expect(axios.put.mock.calls[0][1]).toEqual({ allergens: ["Milk", "Soy"], may_contain: [], reviewed: true });
  expect(element.textContent).toContain("Milk, Soy");
});
