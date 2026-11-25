import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrOrdering } from "./QrOrdering";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("react-router-dom", () => ({ useParams: () => ({ token: "food-token" }) }));
jest.mock("../components/QrTableAssistance", () => ({ QrTableAssistance: () => null }));
jest.mock("../components/QrCheckout", () => ({ QrCheckout: () => null }));
jest.mock("../components/QrGuestFeedback", () => ({ QrGuestFeedback: () => null }));
jest.mock("../components/ProductPhoto", () => ({ ProductPhoto: () => null }));
jest.mock("../components/ApiErrorPanel", () => ({ ApiErrorPanel: () => null }));
jest.mock("../lib/pos", () => ({ formatCurrency: (value) => `Rs ${value}`, newClientKey: () => "request-key" }));
jest.mock("../lib/qrUrls", () => ({ resolveQrApiBaseUrl: () => "http://api" }));

test("guests see allergens/sold-out state and must choose required options before ordering", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  axios.get.mockResolvedValue({ data: { data: {
    business: { name: "Cafe" }, table: { name: "T1" }, ordering: { tax_rate: 18, service_charge_percent: 5.5 }, table_session: { id: "visit", session_key: "key", opened_at: "now" },
    items: [
      { id: "toast", name: "Toast", price: 20, dietary_type: "Veg", allergens: ["Wheat", "Milk"], may_contain: ["Nuts"], allergens_reviewed: true, qr_availability: { available: true }, modifier_groups: [{ id: "g", name: "Toast level", min_select: 1, max_select: 1, options: [{ id: "crispy", name: "Crispy", price: 2 }] }] },
      { id: "cake", name: "Cake", price: 30, qr_availability: { available: false, reason: "Sold out" } },
    ],
  } } });
  axios.post.mockResolvedValue({ data: { data: { id: "sent-order", tracking_token: "tracking", metadata: { approval_status: "pending" } } } });
  const element = document.createElement("div"); document.body.appendChild(element);
  const root = createRoot(element);
  const button = (text) => [...document.body.querySelectorAll("button")].find((node) => node.textContent === text);
  try {
    await act(async () => root.render(<QrOrdering />));
    expect(element.textContent).not.toContain("Contains: Wheat, Milk");
    expect(element.querySelector('[maxlength="200"]')).toBeNull();
    expect(button("Sold out").disabled).toBe(true);
    await act(async () => button("Add").click());
    const sheet = document.querySelector('[role="dialog"]');
    expect(sheet.textContent).toContain("Contains: Wheat, Milk");
    expect(sheet.textContent).toContain("May contain: Nuts");
    expect(sheet.textContent).toContain("Choose one: Toast level");
    expect([...sheet.querySelectorAll("button")].find((node) => node.textContent.startsWith("Add to order")).disabled).toBe(true);
    expect(button("Place Order").disabled).toBe(true);
    await act(async () => sheet.querySelector('input[type="radio"]').click());
    const note = sheet.querySelector('textarea[maxlength="200"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(note, "Less salt");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...sheet.querySelectorAll("button")].find((node) => node.textContent.startsWith("Add to order")).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(element.textContent).toContain("Choices: Crispy");
    expect(element.textContent).toContain("Kitchen request: Less salt");
    // The guest sees what the bill will charge: service charge to the paisa, then GST on items + service charge.
    expect(element.textContent).toContain("Service chargeRs 1.21");
    expect(element.textContent).toContain("GST (18%)Rs 4.18");
    expect(element.textContent).toContain("Estimated totalRs 27.39");
    // Browsing a fresh configuration or dismissing it must not change the cart.
    await act(async () => button("Add").click());
    expect(document.querySelector('textarea[maxlength="200"]').value).toBe("");
    await act(async () => document.querySelector('[aria-label="Close item details"]').click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(element.textContent).toContain("1 in your order");
    expect(element.textContent).toContain("Kitchen request: Less salt");
    await act(async () => button("Place Order").click());
    expect(axios.post.mock.calls[0][1].items).toEqual([expect.objectContaining({ modifier_option_ids: ["crispy"], quoted_unit_price: 22, kitchen_note: "Less salt" })]);
    expect(element.textContent).toContain("Your orders this visit");
  } finally { await act(async () => root.unmount()); element.remove(); }
});
