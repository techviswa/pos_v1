import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../lib/apiUrl";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { ApiErrorPanel } from "../../components/ApiErrorPanel";

const REPORTS = { gst: "GST / tax", sales: "Sales by date", profitability: "Product profitability", hourly: "Hourly sales", staff: "Staff performance", outlets: "Outlet comparison", customers: "Customers" };
const FREQUENCY = { daily: "Daily (yesterday, sent ~7:30 am)", weekly: "Weekly (last 7 days, Mondays)", monthly: "Monthly (last month, on the 1st)" };
const statusText = (row) => {
  if (!row.last_status) return "Not sent yet";
  if (row.last_status === "emailed") return `Emailed for ${row.last_period?.from === row.last_period?.to ? row.last_period?.to : `${row.last_period?.from} to ${row.last_period?.to}`}`;
  if (row.last_status === "not_sent_email_not_configured") return "Not sent: email is not set up on the server";
  return `Failed: ${String(row.last_status).replace(/^failed:\s*/, "")}`;
};
const download = (file) => {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.content_type || "text/plain" }));
  const link = document.createElement("a");
  link.href = url; link.download = file.filename || "report";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Reports emailed on a schedule. "Run now" downloads the same file for the last finished period, so the owner can
 * check it at any time. Email delivery needs the server's email settings; until then each schedule says it was not sent.
 */
export function ScheduledReports() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ report_key: "gst", frequency: "daily", format: "csv", recipients: "" });
  const [busy, setBusy] = useState("");

  const load = async () => {
    try {
      const data = apiData(await axios.get(`${API_URL}/api/reports/schedules`, { withCredentials: true }));
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (failure) { setError(failure); }
  };
  useEffect(() => { void load(); }, []);

  const act = async (key, work, message) => {
    setBusy(key);
    try { const result = await work(); if (message) toast.success(message); await load(); return result; }
    catch (failure) { toast.error(getApiErrorMessage(failure, "Could not update the scheduled report")); return null; }
    finally { setBusy(""); }
  };
  const create = (event) => {
    event.preventDefault();
    void act("create", () => axios.post(`${API_URL}/api/reports/schedules`, form, { withCredentials: true }), "Scheduled report added").then((done) => {
      if (done) setForm((current) => ({ ...current, recipients: "" }));
    });
  };
  const runNow = (row) => act(row.id, async () => {
    const result = apiData(await axios.post(`${API_URL}/api/reports/schedules/${row.id}/run`, {}, { withCredentials: true }));
    if (result?.export) download(result.export);
    return result;
  }, "Report downloaded");

  if (error) return <ApiErrorPanel error={error} onRetry={load} />;
  const emailReady = rows?.[0]?.email_configured;
  return (
    <section className="cf-card cf-card--padded" data-testid="scheduled-reports">
      <div className="cf-card__title"><span>Scheduled reports</span></div>
      <p className="cf-card__meta">Each run covers the last finished period in UTC days, like the report screens. Use "Run now" to download the same file at any time.</p>
      {rows && rows.length && !emailReady ? <p className="cf-card__meta" role="status" style={{ color: "var(--cf-red)" }}>Email is not set up on the server yet, so these reports are not being sent. Ask your administrator to add the email (SMTP) settings.</p> : null}
      <form onSubmit={create} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", alignItems: "end", margin: "12px 0" }} data-testid="schedule-form">
        <label className="cf-field">Report
          <select aria-label="Report" className="cf-select" value={form.report_key} onChange={(event) => setForm({ ...form, report_key: event.target.value })}>
            {Object.entries(REPORTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="cf-field">How often
          <select aria-label="How often" className="cf-select" value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>
            {Object.entries(FREQUENCY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="cf-field">File
          <select aria-label="File type" className="cf-select" value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}>
            <option value="csv">CSV (Excel)</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label className="cf-field" style={{ gridColumn: "1 / -1" }}>Send to (comma-separated emails)
          <input aria-label="Send to" className="cf-input" maxLength={600} placeholder="owner@cafe.com, accounts@cafe.com" required value={form.recipients} onChange={(event) => setForm({ ...form, recipients: event.target.value })} />
        </label>
        <button className="cf-btn cf-btn--primary" disabled={busy === "create"} type="submit">{busy === "create" ? "Adding..." : "Add schedule"}</button>
      </form>
      <div className="cf-table-wrap">
        <table className="cf-table">
          <thead><tr><th>Report</th><th>How often</th><th>Send to</th><th>Last run</th><th>Actions</th></tr></thead>
          <tbody>
            {(rows || []).map((row) => (
              <tr key={row.id}>
                <td>{row.report_name || REPORTS[row.report_key] || row.report_key} ({String(row.format).toUpperCase()})</td>
                <td>{row.frequency}{row.active ? "" : " · paused"}</td>
                <td>{(row.recipients || []).join(", ")}</td>
                <td>{statusText(row)}</td>
                <td>
                  <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="cf-btn cf-btn--small" disabled={Boolean(busy)} onClick={() => runNow(row)} type="button">Run now</button>
                    <button className="cf-btn cf-btn--small" disabled={Boolean(busy)} onClick={() => act(row.id, () => axios.put(`${API_URL}/api/reports/schedules/${row.id}`, { active: !row.active }, { withCredentials: true }), row.active ? "Schedule paused" : "Schedule resumed")} type="button">{row.active ? "Pause" : "Resume"}</button>
                    <button className="cf-btn cf-btn--small cf-btn--danger" disabled={Boolean(busy)} onClick={() => window.confirm("Delete this scheduled report?") && act(row.id, () => axios.delete(`${API_URL}/api/reports/schedules/${row.id}`, { withCredentials: true }), "Scheduled report deleted")} type="button">Delete</button>
                  </span>
                </td>
              </tr>
            ))}
            {rows && !rows.length ? <tr><td colSpan="5">No scheduled reports yet.</td></tr> : null}
            {!rows ? <tr><td colSpan="5">Loading...</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
