import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrCheckoutInbox } from "./QrCheckoutInbox";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../contexts/AuthContext", () => ({ API_URL: "http://api" }));
let mockOutletId = 'outlet', mockIssued;
jest.mock("../core/outlets/store/ActiveOutletContext", () => ({ useActiveOutlet: () => ({ selectedOutletId: mockOutletId }) }));
jest.mock('./QrVisitBilling', () => ({ QrVisitBilling: ({ onIssued }) => { mockIssued = onIssued; return <div>Split invoice preview</div>; } }));
jest.mock("../lib/pos", () => ({ formatCurrency: (value) => `Rs ${value}` }));
jest.mock("../hooks/useAutoRefresh", () => ({ useAutoRefresh: (callback) => { require("react").useEffect(() => { callback(); }, []); } }));

test.each([false, true])('the compact inbox opens only on demand, including a failed background read (%s)', async failed => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockOutletId = 'outlet';
  if (failed) axios.get.mockRejectedValue(new Error('Unavailable'));
  else axios.get.mockResolvedValue({ data: { items: [{ id: 'order', total: 200 }], has_more: false } });
  const element = document.createElement('div'), root = createRoot(element); document.body.appendChild(element);
  try {
    await act(async () => root.render(<QrCheckoutInbox compact />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(element.textContent).toContain(failed ? 'Needs attention' : '1');
    await act(async () => element.querySelector('button').click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain(failed ? 'Unable to load QR bill requests' : 'Issue unpaid bill');
  } finally { await act(async () => root.unmount()); element.remove(); }
});

test.each([true, false, 'paged'])("staff see bill requests and choose whether to use points (response: %s)", async (wrapped) => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const items = [{ id: "order", table: "T1", customer_name: "Guest", total: 200, points_requested: 100 }];
  axios.get.mockResolvedValue({ data: wrapped === 'paged' ? { success: true, data: { items, has_more: true, page: 1 } } : wrapped ? { success: true, data: items } : items });
  axios.post.mockResolvedValue({ data: { data: { id: "invoice" } } });
  const element = document.createElement("div"), root = createRoot(element);
  try {
    await act(async () => root.render(<QrCheckoutInbox />));
    expect(axios.get.mock.calls[0][1].params).toEqual({ outlet_id: "outlet", page: 1 });
    expect(element.textContent).toContain("Loyalty points requested: 100");
    if (process.env.POS_PANEL_FIXTURES) require('fs').writeFileSync(`${process.env.POS_PANEL_FIXTURES}/qr-requests.html`, element.innerHTML);
    const button = [...element.querySelectorAll("button")].find((node) => node.textContent === "Issue without loyalty points");
    await act(async () => button.click());
    expect(axios.post.mock.calls[0]).toEqual(["http://api/api/public/qr/checkout/order/issue", { apply_points: false }, { withCredentials: true }]);
  } finally { await act(async () => root.unmount()); }
});

test('a failed inbox request never claims there are no waiting requests', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockRejectedValue(new Error('Unavailable'));
  const element = document.createElement('div'), root = createRoot(element);
  try {
    await act(async () => root.render(<QrCheckoutInbox />));
    expect(element.querySelector('[role="alert"]').textContent).toContain('Unable to load');
    expect(element.textContent).not.toContain('No final bill requests waiting');
  } finally { await act(async () => root.unmount()); }
});

test('a rejected points request retains the issue-without-points recovery action', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockResolvedValue({ data: { items: [{ id: 'order', total: 200, points_requested: 100 }], has_more: false } });
  axios.post.mockRejectedValue(new Error('Points unavailable'));
  const element = document.createElement('div'), root = createRoot(element);
  try {
    await act(async () => root.render(<QrCheckoutInbox />));
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === 'Issue unpaid bill').click());
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect([...element.querySelectorAll('button')].find(button => button.textContent === 'Issue without loyalty points').disabled).toBe(false);
  } finally { await act(async () => root.unmount()); }
});

test('a split-invoice callback from the previous outlet cannot refresh the new inbox', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockOutletId = 'outlet';
  axios.get.mockResolvedValue({ data: [{ id: 'order', total: 200 }] });
  const element = document.createElement('div'), root = createRoot(element);
  try {
    await act(async () => root.render(<QrCheckoutInbox />));
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === 'Combine rounds / split items').click());
    const issued = mockIssued;
    mockOutletId = 'other';
    await act(async () => root.render(<QrCheckoutInbox />));
    const reads = axios.get.mock.calls.length;
    await act(async () => issued());
    expect(axios.get.mock.calls.length).toBe(reads);
    expect(element.textContent).not.toContain('Split invoice preview');
  } finally { await act(async () => root.unmount()); mockOutletId = 'outlet'; }
});
