import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PublicQrRoutes } from "./PublicQrRoutes";

// CRA's Jest resolver predates React Router's `react-router/dom` export map.
jest.mock("react-router-dom", () => {
  global.TextEncoder = require("util").TextEncoder;
  global.TextDecoder = require("util").TextDecoder;
  return jest.requireActual("react-router");
});

jest.mock("../pages/QrOrdering", () => ({
  QrOrdering: () => <div>Customer menu</div>,
  QrOrderTracking: () => <div>Customer order tracking</div>,
}));

test.each([["/qr/public-token", "Customer menu"], ["/qr/orders/tracking-token", "Customer order tracking"]])("%s never mounts staff authentication", async (path, expected) => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const staff = jest.fn(() => <div>Saved staff session unavailable</div>);
  const Staff = staff;
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><PublicQrRoutes><Staff /></PublicQrRoutes></MemoryRouter>));
    expect(element.textContent).toContain(expected);
    expect(staff).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain("Saved staff session");
  } finally { await act(async () => root.unmount()); }
});

test("staff screens keep their existing authentication boundary", async () => {
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/billing"]}><PublicQrRoutes><div>Staff authentication required</div></PublicQrRoutes></MemoryRouter>));
    expect(element.textContent).toContain("Staff authentication required");
  } finally { await act(async () => root.unmount()); }
});
