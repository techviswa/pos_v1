import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { TableAssistanceInbox } from "./TableAssistanceInbox";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../contexts/AuthContext", () => ({ API_URL: "", useAuth: () => ({ user: { id: "owner", role: "Owner" } }) }));
jest.mock("../core/outlets/store/ActiveOutletContext", () => ({ useActiveOutlet: jest.fn() }));
jest.mock("../lib/liveUpdates", () => ({ subscribeLiveUpdates: () => () => {} }));
jest.mock("sonner", () => ({ toast: { info: jest.fn(), error: jest.fn() } }));
jest.mock("./ApiErrorPanel", () => ({ ApiErrorPanel: ({ error }) => <div role="alert">{error.message}</div> }));
let element, root, outlet;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; outlet = "a";
  useActiveOutlet.mockImplementation(() => ({ selectedOutletId: outlet }));
  axios.get.mockReset(); axios.post.mockReset();
  element = document.createElement("div"); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); });
test("a late response from the old outlet cannot replace the selected outlet's requests", async () => {
  let release;
  axios.get.mockImplementation((_url, options) => options.params.outlet_id === "a" ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ data: { success: true, data: { items: [], staff: [] } } }));
  await act(async () => root.render(<TableAssistanceInbox />));
  outlet = "b"; await act(async () => root.render(<TableAssistanceInbox />));
  await act(async () => release({ data: { success: true, data: { items: [{ id: "old", table_name: "Wrong table", label: "Water", status: "pending", created_at: new Date().toISOString(), history: [] }], staff: [] } } }));
  expect(element.textContent).not.toContain("Wrong table");
  expect(element.textContent).toContain("No active requests");
  expect(axios.get.mock.calls.at(-1)[1].params.outlet_id).toBe("b");
});

test.each([true, false])("assistance accepts wrapped or already-unwrapped API responses (wrapped=%s)", async (wrapped) => {
  const payload = { items: [{ id: "water", table_name: "T1", label: "Water", status: "pending", created_at: new Date().toISOString(), history: [] }], staff: [] };
  axios.get.mockResolvedValue({ data: wrapped ? { success: true, data: payload } : payload });
  await act(async () => root.render(<TableAssistanceInbox />));
  expect(element.textContent).toContain("T1");
  expect(element.textContent).toContain("Water");
  expect(element.textContent).not.toContain("Backend unavailable");
});
