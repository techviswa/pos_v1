import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrOrderTracking } from "./QrOrdering";

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("react-router-dom", () => ({ useParams: () => ({ trackingToken: "tracking" }) }));
jest.mock("../components/QrTableAssistance", () => ({ QrTableAssistance: () => null }));
jest.mock("../components/QrCheckout", () => ({ QrCheckout: () => null }));
jest.mock("../components/QrGuestFeedback", () => ({ QrGuestFeedback: () => null }));
jest.mock("../components/ProductPhoto", () => ({ ProductPhoto: () => null }));
jest.mock("../components/ApiErrorPanel", () => ({ ApiErrorPanel: () => null }));
jest.mock("../lib/pos", () => ({ formatCurrency: (value) => `Rs ${value}`, newClientKey: () => "request" }));
jest.mock("../lib/qrUrls", () => ({ resolveQrApiBaseUrl: () => "http://api" }));

test("tracking keeps kitchen progress on a temporary failure and recovers automatically", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  const result = (status) => ({ data: { data: { id: "order", status: "billed", items: [], tracking: { status } } } });
  axios.get.mockResolvedValueOnce(result("preparing")).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(result("ready"));
  const element = document.createElement("div"), root = createRoot(element);
  try {
    await act(async () => root.render(<QrOrderTracking />));
    expect(element.textContent).toContain("Status: PREPARING");
    expect(element.querySelectorAll(".cf-qr-tracking-steps .is-active")).toHaveLength(3);
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(element.textContent).toContain("Status: PREPARING");
    expect(element.textContent).toContain("Connection interrupted");
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(element.textContent).toContain("Status: READY");
    expect(element.textContent).not.toContain("Connection interrupted");
  } finally {
    await act(async () => root.unmount());
    jest.useRealTimers();
  }
});
