import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { StockCount } from "./StockCount";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });

const setValue = (input, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};
const inventory = [{ id: "milk", name: "Milk", unit: "l", current_stock: 15 }, { id: "sugar", name: "Sugar", unit: "kg", current_stock: 5 }];

test("an outlet count shows each difference and sends only the counted items with the outlet", async () => {
  axios.get.mockResolvedValue({ data: [{ id: "oi-1", inventory_id: "milk", inventory_name: "Milk", unit: "l", stock: 24.7, enabled: true }, { id: "virtual_sugar", inventory_id: "sugar", inventory_name: "Sugar", unit: "kg", stock: 0, enabled: false }] });
  axios.post.mockResolvedValue({ data: { adjustments: [{ inventory_name: "Milk", variance: -0.7 }] } });
  const onDone = jest.fn();
  await act(async () => root.render(<StockCount apiUrl="" inventory={inventory} outlets={[{ id: "main", name: "Main Outlet" }]} onDone={onDone} />));
  await act(async () => document.querySelector('[data-testid="open-stock-count"]').click());
  await act(async () => setValue(document.querySelector('[aria-label="Count location"]'), "main"));
  expect(axios.get).toHaveBeenCalledWith("/api/outlets/main/inventory", { withCredentials: true });
  await act(async () => setValue(document.querySelector('[aria-label="Counted Milk"]'), "24"));
  expect(document.querySelector('[data-testid="stock-count-form"]').textContent).toContain("-0.7");
  await act(async () => document.querySelector('[data-testid="stock-count-form"]').requestSubmit());
  expect(axios.post).toHaveBeenCalledWith("/api/inventory/stock-audits", {
    stock_location: "outlet", outlet_id: "main", reason: "Physical stock count", counts: [{ inventory_id: "milk", counted_quantity: 24 }],
  }, { withCredentials: true });
  expect(document.querySelector('[data-testid="stock-count-result"]').textContent).toContain("Milk -0.7");
  expect(onDone).toHaveBeenCalled();
});

test("a central count cannot be saved with nothing counted", async () => {
  await act(async () => root.render(<StockCount apiUrl="" inventory={inventory} />));
  await act(async () => document.querySelector('[data-testid="open-stock-count"]').click());
  const save = [...document.querySelectorAll("button")].find((node) => node.textContent.startsWith("Save count"));
  expect(save.disabled).toBe(true);
  await act(async () => setValue(document.querySelector('[aria-label="Counted Sugar"]'), "4.5"));
  expect(save.disabled).toBe(false);
  expect(save.textContent).toBe("Save count (1)");
});
