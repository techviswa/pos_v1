import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { BatchList } from "./BatchList";
import { setFeatureOwner } from "../platform/store/serverFeatures";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); await setFeatureOwner(""); });

const features = (enabled) => ({ data: { success: true, data: { items: [{ key: "batch-tracking", enabled }] } } });

test("hidden when the plan has no batch tracking", async () => {
  axios.get.mockImplementation((url) => Promise.resolve(url.endsWith("/api/features") ? features(false) : { data: {} }));
  await act(async () => { await setFeatureOwner("u:starter"); });
  await act(async () => root.render(<BatchList apiUrl="" />));
  expect(element.querySelector('[data-testid="batch-list"]')).toBeNull();
});

test("shows lots with estimated remaining and expiry alerts, and records a lot without changing stock", async () => {
  const list = { estimate_note: "Remaining quantities are estimated.", alerts: { expired: 1, expiring: 1 }, items: [
    { id: "b1", batch_no: "L-OUT", inventory_name: "Milk", unit: "l", location: "Main", received_quantity: 4, estimated_remaining: 4, expiry_date: "2026-11-25", days_to_expiry: -1, status: "expired" },
    { id: "b2", batch_no: "L-GONE", inventory_name: "Milk", unit: "l", location: "Central kitchen", received_quantity: 3, estimated_remaining: 0, expiry_date: "2026-12-30", days_to_expiry: 34, status: "used_up" },
  ] };
  axios.get.mockImplementation((url) => Promise.resolve(url.endsWith("/api/features") ? features(true) : { data: { success: true, data: list } }));
  axios.post.mockResolvedValue({ data: {} });
  await act(async () => { await setFeatureOwner("u:enterprise"); });
  await act(async () => root.render(<BatchList apiUrl="" inventory={[{ id: "milk", name: "Milk", unit: "l" }]} />));
  expect(element.textContent).toContain("1 expired · 1 expiring within 14 days");
  expect(element.textContent).toContain("Expired — remove from use");
  expect(element.textContent).not.toContain("L-GONE");
  const setValue = (input, value) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value); input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
  await act(async () => [...element.querySelectorAll("button")].find((node) => node.textContent.startsWith("Record a lot")).click());
  await act(async () => { setValue(element.querySelector('[aria-label="Ingredient"]'), "milk"); setValue(element.querySelector('[aria-label="Batch number"]'), "L-9"); setValue(element.querySelector('[aria-label="Expiry date"]'), "2026-12-31"); setValue(element.querySelector('[aria-label="Quantity"]'), "2"); });
  await act(async () => element.querySelector('[data-testid="batch-form"]').requestSubmit());
  expect(axios.post).toHaveBeenCalledWith("/api/batch-tracking", { inventory_id: "milk", batch_no: "L-9", expiry_date: "2026-12-31", quantity: 2 }, { withCredentials: true });
});
