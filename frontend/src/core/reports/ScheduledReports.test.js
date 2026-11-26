import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import { ScheduledReports } from "./ScheduledReports";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../lib/apiUrl", () => ({ API_URL: "http://api" }));

let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
const setValue = (input, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value").set.call(input, value);
  input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};

test("schedules show honest delivery status, and can be added, run, paused and deleted", async () => {
  const schedule = { id: "sch_1", report_key: "gst", report_name: "GST / tax", format: "csv", frequency: "daily", recipients: ["owner@cafe.com"], active: true, email_configured: false, last_status: "not_sent_email_not_configured", last_period: { from: "2026-11-30", to: "2026-11-30" } };
  axios.get.mockResolvedValue({ data: { success: true, data: [schedule] } });
  axios.post.mockResolvedValue({ data: { success: true, data: { export: { filename: "gst-report.csv", content: "a,b", content_type: "text/csv" } } } });
  axios.put.mockResolvedValue({ data: {} });
  axios.delete.mockResolvedValue({ data: {} });
  global.URL.createObjectURL = jest.fn(() => "blob:report"); global.URL.revokeObjectURL = jest.fn();
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  const button = (text) => [...element.querySelectorAll("button")].find((node) => node.textContent === text);
  try {
    await act(async () => root.render(<ScheduledReports />));
    expect(element.textContent).toContain("Not sent: email is not set up on the server");
    expect(element.textContent).toContain("these reports are not being sent");
    await act(async () => setValue(element.querySelector('[aria-label="How often"]'), "weekly"));
    await act(async () => setValue(element.querySelector('[aria-label="Send to"]'), "a@b.co, c@d.co"));
    await act(async () => element.querySelector('[data-testid="schedule-form"]').requestSubmit());
    expect(axios.post).toHaveBeenCalledWith("http://api/api/reports/schedules", { report_key: "gst", frequency: "weekly", format: "csv", recipients: "a@b.co, c@d.co" }, { withCredentials: true });
    await act(async () => button("Run now").click());
    expect(axios.post).toHaveBeenCalledWith("http://api/api/reports/schedules/sch_1/run", {}, { withCredentials: true });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    await act(async () => button("Pause").click());
    expect(axios.put).toHaveBeenCalledWith("http://api/api/reports/schedules/sch_1", { active: false }, { withCredentials: true });
    await act(async () => button("Delete").click());
    expect(axios.delete).toHaveBeenCalledWith("http://api/api/reports/schedules/sch_1", { withCredentials: true });
  } finally { confirm.mockRestore(); }
});
