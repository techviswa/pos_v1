import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { Reports } from "./Reports";

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../components/Layout", () => ({ Layout: ({ children }) => <div>{children}</div> }));
jest.mock("../contexts/UiContext", () => ({ useUi: () => ({ settings: { currency: "INR" } }) }));
jest.mock("../core/outlets/store/ActiveOutletContext", () => ({ useActiveOutlet: () => ({ selectedOutletId: "main" }) }));
jest.mock("../core/reports/SalesVisuals", () => ({ SalesVisuals: () => <div>Sales chart</div> }));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "Owner" } }) }));

let root, element;
const reportCalls = () => axios.get.mock.calls.filter(([url]) => url.endsWith("/api/reports"));
const click = async (text) => act(async () => [...element.querySelectorAll("button")].find((button) => button.textContent === text).click());
const change = async (selector, value) => act(async () => {
  const input = element.querySelector(selector);
  Object.getOwnPropertyDescriptor(input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
});

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockReset();
  axios.get.mockResolvedValue({ data: {} });
  element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });

test("invalid draft dates stay editable and never trigger a report request", async () => {
  await act(async () => root.render(<Reports />));
  expect(axios.get.mock.calls.every(([url]) => url.endsWith("/api/reports"))).toBe(true);
  await change('[aria-label="Report period"]', "custom");
  const before = reportCalls().length;
  await change('[aria-label="From date"]', "2026-10-23");
  await change('[aria-label="To date"]', "2026-10-01");
  await click("Apply dates");
  expect(reportCalls()).toHaveLength(before);
  expect(element.textContent).toContain("End date must be on or after");
  await change('[aria-label="To date"]', "2026-10-24");
  await click("Apply dates");
  expect(reportCalls().at(-1)[1].params).toEqual({ from: "2026-10-23", to: "2026-10-24", outlet_id: "main" });
  expect(element.textContent).toContain("Sales chart");
});

test("a failed load keeps date controls available and retry can recover", async () => {
  let fail = true;
  axios.get.mockImplementation((url) => url.endsWith("/api/reports") && fail ? Promise.reject(new Error("Temporary failure")) : Promise.resolve({ data: {} }));
  await act(async () => root.render(<Reports />));
  expect(element.querySelector('[aria-label="Report period"]')).not.toBeNull();
  expect(element.textContent).toContain("Try Again");
  fail = false;
  await click("Try Again");
  expect(element.textContent).toContain("Sales chart");
  expect(element.textContent).not.toContain("Try Again");
});
