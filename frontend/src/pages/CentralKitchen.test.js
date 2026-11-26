import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { CentralKitchen } from "./CentralKitchen";
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));
jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }));
jest.mock("../components/Layout", () => ({ Layout: ({ children }) => <div>{children}</div> }));
jest.mock("../components/ui/dialog", () => ({ Dialog: ({ open, children }) => open ? children : null, DialogContent: ({ children }) => <div>{children}</div>, DialogHeader: ({ children }) => <div>{children}</div>, DialogTitle: ({ children }) => <h2>{children}</h2>, DialogFooter: ({ children }) => <div>{children}</div> }));
jest.mock("../core/outlets/store/ActiveOutletContext", () => ({ useActiveOutlet: () => ({ selectedOutletId: "" }) }));
jest.mock("../lib/liveUpdates", () => ({ subscribeLiveUpdates: () => () => {} }));
jest.mock("../lib/apiUrl", () => ({ API_URL: "http://api" }));
jest.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "Owner" } }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
test("kitchen shows precise quantities, real transfer state and preserves dirty costs across refresh", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const snapshot = { stock_location: "Central store", overview: {}, outlets: [{ id: "a", name: "Outlet", code: "A" }], central_inventory: [{ id: "mayo", name: "Mayo", current_stock: 4.970000000000001, unit: "kg", reorder_level: 1, conversion_cost: 10 }], low_stock_items: [], outlet_inventory: [], purchase_orders: [], route_plans: [], restock_logs: [{ id: "transfer", outlet_name: "Outlet", status: "pending_approval", items: [{ inventory_name: "Mayo", requested_quantity: 1, unit: "kg" }] }] };
  axios.get.mockResolvedValue({ data: snapshot });
  const node = document.createElement("div"), root = createRoot(node);
  try {
    await act(async () => root.render(<CentralKitchen />));
    expect(node.textContent).toContain("4.97 kg"); expect(node.textContent).not.toContain("4.970000000");
    expect(node.textContent).toContain("Awaiting approval");
    expect(node.textContent).not.toContain("Outlet restocked");
    const field = node.querySelector('input[type="number"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, "23"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => [...node.querySelectorAll("button")].find((button) => button.textContent === "Refresh").click());
    expect(field.value).toBe("23");
  } finally { await act(async () => root.unmount()); }
});

test("managers approve or reject outlet stock requests and move delivery routes along", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const snapshot = { stock_location: "Central store", overview: {}, outlets: [{ id: "a", name: "Outlet", code: "A" }], central_inventory: [], low_stock_items: [], outlet_inventory: [], restock_logs: [],
    purchase_orders: [
      { id: "po-1", outlet_name: "Outlet", priority: "High", status: "pending", items: [{ inventory_name: "Flour", requested_quantity: 4, unit: "kg" }] },
      { id: "po-2", outlet_name: "Outlet", priority: "Low", status: "approved", transfer_status: "approved", items: [] },
      { id: "po-3", outlet_name: "Outlet", priority: "Low", status: "rejected", notes: "Rejected by Owner: too much", items: [] },
    ],
    route_plans: [{ id: "r-1", route_name: "Morning run", status: "scheduled", stops: [{ outlet_name: "Outlet" }] }, { id: "r-2", route_name: "Evening run", status: "in_transit", stops: [] }] };
  axios.get.mockResolvedValue({ data: snapshot });
  axios.post.mockResolvedValue({ data: { status: "approved", dispatched: true } });
  const prompt = jest.spyOn(window, "prompt").mockReturnValue("Order a smaller batch");
  const node = document.createElement("div"), root = createRoot(node);
  const click = (text) => act(async () => [...node.querySelectorAll("button")].find((button) => button.textContent === text).click());
  try {
    await act(async () => root.render(<CentralKitchen />));
    expect(node.textContent).toContain("Flour: 4 kg");
    expect(node.textContent).toContain("Dispatched — awaiting outlet receipt");
    expect(node.textContent).toContain("Rejected by Owner: too much");
    await click("Approve & dispatch");
    expect(axios.post).toHaveBeenCalledWith("http://api/api/central-kitchen/purchase-orders/po-1/approve", {}, { withCredentials: true });
    await click("Reject");
    expect(axios.post).toHaveBeenCalledWith("http://api/api/central-kitchen/purchase-orders/po-1/reject", { reason: "Order a smaller batch" }, { withCredentials: true });
    await click("Start route");
    expect(axios.post).toHaveBeenCalledWith("http://api/api/central-kitchen/routes/r-1/start", {}, { withCredentials: true });
    await click("Mark delivered");
    expect(axios.post).toHaveBeenCalledWith("http://api/api/central-kitchen/routes/r-2/complete", {}, { withCredentials: true });
    expect(node.textContent).toContain("In transit");
  } finally { prompt.mockRestore(); await act(async () => root.unmount()); }
});
