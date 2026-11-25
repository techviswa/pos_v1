import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { FulfillmentTablePanel } from "./FulfillmentTablePanel";
import { createInitialOrderMeta } from "../utils/fulfillmentMode";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });

const outlets = [{ id: "outlet-a", name: "Main Outlet" }, { id: "outlet-b", name: "Airport" }];
const setValue = (input, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};
const renderPanel = (props) => act(async () => root.render(
  <FulfillmentTablePanel canManageTables orderMeta={createInitialOrderMeta()} areaItems={[]} tableItems={[]} reservationItems={[]} {...props} />,
));
const openAddTable = () => act(async () => [...document.querySelectorAll("button")].find((button) => /Add Table/.test(button.textContent)).click());
const save = () => act(async () => [...document.querySelectorAll("[role=dialog] button")].find((button) => /^(Create|Save|Add)/.test(button.textContent.trim()) && !/Category/.test(button.textContent)).click());

test("with several outlets a new table is linked to the chosen outlet, defaulting to the active one", async () => {
  const onCreateTable = jest.fn(() => Promise.resolve());
  await renderPanel({ outletItems: outlets, activeOutletId: "outlet-b", onCreateTable });
  await openAddTable();
  const select = document.querySelector('[data-testid="table-outlet"]');
  expect(select.value).toBe("outlet-b");
  await act(async () => setValue(document.querySelector("[role=dialog] input"), "P9"));
  await act(async () => setValue(select, "outlet-a"));
  await save();
  expect(onCreateTable).toHaveBeenCalledWith(expect.objectContaining({ name: "P9", meta: { outlet_id: "outlet-a" } }));
});

test("a one-outlet business never sees or needs the outlet field", async () => {
  const onCreateTable = jest.fn(() => Promise.resolve());
  await renderPanel({ outletItems: [outlets[0]], activeOutletId: "outlet-a", onCreateTable });
  await openAddTable();
  expect(document.querySelector('[data-testid="table-outlet"]')).toBeNull();
  await act(async () => setValue(document.querySelector("[role=dialog] input"), "T9"));
  await save();
  expect(onCreateTable).toHaveBeenCalledWith(expect.objectContaining({ name: "T9", meta: {} }));
});
