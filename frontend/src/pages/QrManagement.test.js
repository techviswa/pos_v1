import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QrManagement } from "./QrManagement";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";

jest.mock("../components/Layout", () => ({ Layout: ({ children }) => <div>{children}</div> }));
jest.mock("qrcode", () => ({ toDataURL: () => Promise.resolve("data:image/png;base64,test-qr") }));
jest.mock("../features/billing/fulfillment/services/fulfillment.service", () => ({ fulfillmentService: {
  fetchTableManagement: jest.fn(() => Promise.resolve({ tables: { items: [{ id: "table-1", name: "Table 1", qr_ordering: { token: "active-token", active: true } }] } })),
  deleteTableQrCode: jest.fn(() => Promise.resolve({ deleted: true })),
  fetchSettings: jest.fn(() => Promise.resolve({ capabilities: { qrOrderingEnabled: true } })),
  updateSettings: jest.fn((settings) => Promise.resolve(settings)),
} }));

beforeEach(() => {
  fulfillmentService.fetchTableManagement.mockResolvedValue({ tables: { items: [{ id: "table-1", name: "Table 1", qr_ordering: { token: "active-token", active: true } }] } });
  fulfillmentService.deleteTableQrCode.mockResolvedValue({ deleted: true });
  fulfillmentService.fetchSettings.mockResolvedValue({ capabilities: { qrOrderingEnabled: true } });
  fulfillmentService.updateSettings.mockImplementation((settings) => Promise.resolve(settings));
});

test("QR workspace displays a scannable image, download and menu link for each active table", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QrManagement />));
    const image = element.querySelector('img[alt="Scan to order at Table 1"]');
    expect(image).not.toBeNull();
    expect(image.src).toBe("data:image/png;base64,test-qr");
    expect(image.width).toBe(128);
    expect(element.querySelector('a[download]').download).toBe("table-table-1-qr.png");
    expect([...element.querySelectorAll("a")].find((link) => link.textContent === "Open menu").href).toContain("/qr/active-token");
    expect(element.querySelector('[aria-label="Scannable table QR codes"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});

test("Delete QR confirms, deletes only the QR and refreshes the workspace", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QrManagement />));
    fulfillmentService.fetchTableManagement.mockResolvedValueOnce({ tables: { items: [{ id: "table-1", name: "Table 1" }] } });
    await act(async () => [...element.querySelectorAll("button")].find((button) => button.textContent === "Delete QR").click());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("table and its orders will be kept"));
    expect(fulfillmentService.deleteTableQrCode).toHaveBeenCalledWith("table-1");
    expect(element.querySelector('img[alt="Scan to order at Table 1"]')).toBeNull();
    expect(element.textContent).toContain("Table 1");
  } finally { confirm.mockRestore(); await act(async () => root.unmount()); }
});

test("When QR ordering is off, the workspace says guests cannot order and turns it on in one step", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  fulfillmentService.fetchSettings.mockResolvedValue({ capabilities: { qrOrderingEnabled: false } });
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(<QrManagement />));
    expect(element.querySelector('[data-testid="qr-ordering-blocked"]').textContent).toContain("QR ordering is off");
    expect(element.textContent).toContain("Code ready · ordering off");
    await act(async () => element.querySelector('[data-testid="qr-turn-on"]').click());
    expect(fulfillmentService.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ capabilities: expect.objectContaining({ qrOrderingEnabled: true }) }));
    expect(element.querySelector('[data-testid="qr-ordering-blocked"]')).toBeNull();
    expect(element.textContent).toContain("Active");
  } finally { await act(async () => root.unmount()); }
});
