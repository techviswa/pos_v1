import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { QrServiceAnalytics } from "./QrServiceAnalytics";

let mockOutlet = "main";
jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("../contexts/AuthContext", () => ({ API_URL: "http://api", useAuth: () => ({ user: { role: "Owner" } }) }));
jest.mock("../core/outlets/store/ActiveOutletContext", () => ({ useActiveOutlet: () => ({ selectedOutletId: mockOutlet }) }));
jest.mock("../lib/pos", () => ({ formatCurrency: (value) => `Rs ${value}`, hasPermission: () => true }));
const payload = (comment = "Slow service") => ({ data: { success: true, data: {
  period: { from: "2026-10-19", to: "2026-10-25" }, checked_at: "2026-10-25T10:00:00Z",
  summary: { menu_opens: 4, orders: 2, accepted: 1, median_approval_minutes: null, approval_samples: 0, median_prep_minutes: 20, prep_samples: 1, late_prep: 0, assistance_requests: 1, open_requests: 0, overdue_requests: 0, average_rating: 2, rating_samples: 1, needs_attention: 1 },
  daily: [{ date: "2026-10-25", orders: 2, requests: 1 }], pipeline: [{ status: "ready", count: 1 }], assistance: [], offers: [], rating_distribution: [{ rating: 2, count: 1 }], reviews_total: 1,
  reviews: [{ id: "review", table: "T1", rating: 2, comment, status: "new", needs_attention: true, created_at: "2026-10-25T10:00:00Z", topics: ["speed"], internal_note: "", history: [] }],
} } });
let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; mockOutlet = "main"; element = document.createElement("div"); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); });
test("service analytics shows missing samples clearly and saves private follow-up status", async () => {
  axios.get.mockResolvedValue({ data: payload().data.data }); axios.post.mockResolvedValue({ data: { success: true } });
  await act(async () => root.render(<QrServiceAnalytics />));
  expect(axios.get.mock.calls[0][1].params.outlet_id).toBe("main");
  expect(element.textContent).toContain("No samples"); expect(element.textContent).toContain("Slow service");
  const note = element.querySelector("textarea");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(note, "Reviewed queue staffing"); note.dispatchEvent(new Event("input", { bubbles: true })); });
  const resolve = [...element.querySelectorAll("button")].find((node) => node.textContent === "Mark resolved");
  await act(async () => resolve.click());
  expect(axios.post.mock.calls[0][1]).toEqual({ status: "resolved", internal_note: "Reviewed queue staffing" });
});
test("a late report from the previous outlet cannot expose old review text", async () => {
  let finishOld;
  axios.get.mockImplementation((url, options) => options.params.outlet_id === "main" ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve(payload("New outlet review")));
  await act(async () => root.render(<QrServiceAnalytics />));
  mockOutlet = "other";
  await act(async () => root.render(<QrServiceAnalytics />));
  expect(element.textContent).toContain("New outlet review");
  await act(async () => finishOld(payload("Private old outlet review")));
  expect(element.textContent).not.toContain("Private old outlet review");
  expect(element.textContent).toContain("New outlet review");
});
