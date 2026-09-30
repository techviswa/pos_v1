import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { PeriodPicker } from "../core/staff/PeriodPicker";
import {
  customRange, downloadCsv, formatDateTime, formatMinutes, formatTime, fromLocalInput, presetRange, rangeQuery, toDateInput, toLocalInput,
} from "../core/staff/staffTime";

const emptyShift = () => ({ id: null, user_id: "", outlet_id: "", clock_in_at: "", clock_out_at: "", breaks: [], note: "", reason: "" });
const toForm = (entry) => ({
  id: entry.id,
  user_id: entry.user_id,
  user_name: entry.user_name,
  outlet_id: entry.outlet_id || "",
  clock_in_at: toLocalInput(entry.clock_in_at),
  clock_out_at: toLocalInput(entry.clock_out_at),
  open: entry.open,
  breaks: entry.breaks.map((row) => ({ start_at: toLocalInput(row.start_at), end_at: toLocalInput(row.end_at) })),
  note: entry.note || "",
  reason: "",
});

/** Team hours: who worked when, fixing missed or wrong clock-ins (always with a reason), and PINs. */
export const Attendance = () => {
  const { user } = useAuth();
  const today = toDateInput(new Date());
  const [period, setPeriod] = useState({ preset: "this_week", fromDate: today, toDate: today });
  const [outletFilter, setOutletFilter] = useState("");
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [team, setTeam] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [pinFor, setPinFor] = useState({ userId: "", pin: "" });

  const range = useMemo(
    () => (period.preset === "custom" ? customRange(period.fromDate, period.toDate) : presetRange(period.preset)),
    [period],
  );
  const query = `${rangeQuery(range)}${outletFilter ? `&outlet_id=${encodeURIComponent(outletFilter)}` : ""}`;

  const load = async () => {
    try {
      const [summaryResponse, entriesResponse, teamResponse, outletResponse] = await Promise.all([
        axios.get(`${API_URL}/api/attendance/summary?${query}`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/attendance/entries?${query}`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/attendance/team`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/outlets`, { withCredentials: true }),
      ]);
      setSummary(apiData(summaryResponse) || null);
      setEntries(Array.isArray(apiData(entriesResponse)) ? apiData(entriesResponse) : []);
      setTeam(Array.isArray(apiData(teamResponse)) ? apiData(teamResponse) : []);
      setOutlets(Array.isArray(outletResponse.data) ? outletResponse.data : apiData(outletResponse) || outletResponse.data?.items || []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { liveResources: ["attendance"], refreshOnFocus: true });
  // A new period or outlet loads again (the first load is done by the refresh hook).
  const reloadForQuery = useEffectEvent(() => load());
  const lastQueryRef = useRef(query);
  useEffect(() => {
    if (lastQueryRef.current === query) return;
    lastQueryRef.current = query;
    reloadForQuery();
  }, [query, reloadForQuery]);

  const outletName = (id) => outlets.find((outlet) => outlet.id === id)?.name || (id ? "Outlet" : "-");

  const save = async (event) => {
    event.preventDefault();
    const payload = {
      outlet_id: form.outlet_id || null,
      clock_in_at: fromLocalInput(form.clock_in_at),
      breaks: form.breaks.filter((row) => row.start_at).map((row) => ({ start_at: fromLocalInput(row.start_at), end_at: fromLocalInput(row.end_at) })),
      note: form.note,
      reason: form.reason,
    };
    if (form.clock_out_at || !form.open) payload.clock_out_at = fromLocalInput(form.clock_out_at);
    try {
      if (form.id) await axios.put(`${API_URL}/api/attendance/entries/${form.id}`, payload, { withCredentials: true });
      else await axios.post(`${API_URL}/api/attendance/entries`, { ...payload, user_id: form.user_id }, { withCredentials: true });
      toast.success(form.id ? "Shift corrected" : "Shift added");
      setForm(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save the shift"));
    }
  };

  const closeShift = async (entry) => {
    const reason = window.prompt(`Close ${entry.user_name}'s open shift now. Reason:`, "Forgot to clock out");
    if (!reason) return;
    try {
      await axios.post(`${API_URL}/api/attendance/entries/${entry.id}/close`, { reason }, { withCredentials: true });
      toast.success("Shift closed");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not close the shift"));
    }
  };

  const removeShift = async (entry) => {
    const reason = window.prompt(`Remove this shift of ${entry.user_name}? It stays in the audit history. Reason:`);
    if (!reason) return;
    try {
      await axios.delete(`${API_URL}/api/attendance/entries/${entry.id}`, { data: { reason }, withCredentials: true });
      toast.success("Shift removed");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not remove the shift"));
    }
  };

  const savePin = async (event) => {
    event.preventDefault();
    try {
      await axios.put(`${API_URL}/api/attendance/staff/${pinFor.userId}/pin`, { pin: pinFor.pin || null }, { withCredentials: true });
      toast.success(pinFor.pin ? "PIN set; tell the staff member privately" : "PIN cleared");
      setPinFor({ userId: "", pin: "" });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not set the PIN"));
    }
  };

  const exportCsv = () => downloadCsv(`attendance-${toDateInput(range.from)}.csv`, [
    ["Staff", "Role", "Outlet", "Clock in", "Clock out", "Break minutes", "Worked minutes", "Source", "Corrected", "Note"],
    ...entries.map((entry) => [entry.user_name, entry.role, outletName(entry.outlet_id), entry.clock_in_at, entry.clock_out_at || "open",
      entry.break_minutes, entry.worked_minutes, entry.source, entry.edits.length ? "yes" : "no", entry.note]),
  ]);

  return (
    <Layout title="Attendance">
      <div className="cf-page" data-testid="attendance-page">
        <div className="cf-page__header">
          <div>
            <h1>Attendance</h1>
            <p>Hours worked by the team. Corrections always need a reason and are kept in each shift's history. You cannot change your own hours.</p>
          </div>
          <div className="cf-page__header-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="cf-btn cf-btn--secondary" type="button" onClick={exportCsv} disabled={!entries.length}>Export CSV</button>
            <button className="cf-btn cf-btn--primary" type="button" onClick={() => setForm(emptyShift())}>Add missed shift</button>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <select aria-label="Outlet" className="cf-select" style={{ width: "auto" }} value={outletFilter} onChange={(event) => setOutletFilter(event.target.value)}>
            <option value="">All outlets</option>
            {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
          </select>
        </div>

        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        {form ? (
          <form className="cf-card cf-card--padded" onSubmit={save} data-testid="shift-form" style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <strong>{form.id ? `Correct ${form.user_name}'s shift` : "Add a missed shift"}</strong>
            <div className="cf-grid-2">
              {form.id ? null : (
                <div className="cf-field">
                  <label htmlFor="shift-user">Staff member</label>
                  <select className="cf-select" id="shift-user" required value={form.user_id} onChange={(event) => setForm({ ...form, user_id: event.target.value })}>
                    <option value="">Choose</option>
                    {team.filter((member) => member.id !== user?.id || user?.role === "Owner").map((member) => <option key={member.id} value={member.id}>{member.name} ({member.role})</option>)}
                  </select>
                </div>
              )}
              <div className="cf-field">
                <label htmlFor="shift-outlet">Outlet</label>
                <select className="cf-select" id="shift-outlet" value={form.outlet_id} onChange={(event) => setForm({ ...form, outlet_id: event.target.value })}>
                  <option value="">No specific outlet</option>
                  {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
                </select>
              </div>
            </div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label htmlFor="shift-in">Clock in</label>
                <input className="cf-input" id="shift-in" required type="datetime-local" value={form.clock_in_at} onChange={(event) => setForm({ ...form, clock_in_at: event.target.value })} />
              </div>
              <div className="cf-field">
                <label htmlFor="shift-out">Clock out{form.open ? " (leave empty while still working)" : ""}</label>
                <input className="cf-input" id="shift-out" required={!form.open} type="datetime-local" value={form.clock_out_at} onChange={(event) => setForm({ ...form, clock_out_at: event.target.value })} />
              </div>
            </div>
            <div className="cf-field">
              <label>Breaks</label>
              {form.breaks.map((row, index) => (
                <div key={index} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                  <input aria-label={`Break ${index + 1} start`} className="cf-input" style={{ flex: "1 1 180px" }} type="datetime-local" value={row.start_at}
                    onChange={(event) => setForm({ ...form, breaks: form.breaks.map((entry, entryIndex) => (entryIndex === index ? { ...entry, start_at: event.target.value } : entry)) })} />
                  <input aria-label={`Break ${index + 1} end`} className="cf-input" style={{ flex: "1 1 180px" }} type="datetime-local" value={row.end_at}
                    onChange={(event) => setForm({ ...form, breaks: form.breaks.map((entry, entryIndex) => (entryIndex === index ? { ...entry, end_at: event.target.value } : entry)) })} />
                  <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setForm({ ...form, breaks: form.breaks.filter((_, entryIndex) => entryIndex !== index) })}>Remove</button>
                </div>
              ))}
              <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setForm({ ...form, breaks: [...form.breaks, { start_at: "", end_at: "" }] })}>Add break</button>
            </div>
            <div className="cf-grid-2">
              <div className="cf-field">
                <label htmlFor="shift-note">Note</label>
                <input className="cf-input" id="shift-note" maxLength={300} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
              </div>
              <div className="cf-field">
                <label htmlFor="shift-reason">Reason for this change (required)</label>
                <input className="cf-input" id="shift-reason" maxLength={300} required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
              </div>
            </div>
            <div className="cf-dialog-actions">
              <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setForm(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary" type="submit">Save</button>
            </div>
          </form>
        ) : null}

        <div className="cf-metrics" style={{ marginTop: 12 }}>
          <div className="cf-metric"><div className="cf-metric__label">Hours worked</div><div className="cf-metric__value">{formatMinutes(summary?.totals?.worked_minutes)}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Shifts</div><div className="cf-metric__value">{summary?.totals?.entries || 0}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">On the clock now</div><div className="cf-metric__value">{team.filter((member) => member.clocked_in).length}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Missing clock-outs</div><div className="cf-metric__value">{summary?.totals?.missing_clock_out || 0}</div></div>
        </div>

        <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
          <div className="cf-page__overline">Hours by person</div>
          {(summary?.staff || []).length ? (
            <table className="cf-table">
              <thead><tr><th>Staff</th><th>Role</th><th>Days</th><th>Shifts</th><th>Worked</th><th>Breaks</th><th>Flags</th></tr></thead>
              <tbody>
                {summary.staff.map((row) => (
                  <tr key={row.user_id || row.name}>
                    <td>{row.name}</td>
                    <td>{row.role || "-"}</td>
                    <td>{row.days_worked}</td>
                    <td>{row.entries}</td>
                    <td>{formatMinutes(row.worked_minutes)}</td>
                    <td>{formatMinutes(row.break_minutes)}</td>
                    <td>
                      {row.open_entries ? <span className="cf-badge cf-badge--blue">{row.open_entries} open</span> : null}{" "}
                      {row.missing_clock_out ? <span className="cf-badge cf-badge--amber">{row.missing_clock_out} missing clock-out</span> : null}{" "}
                      {row.edited_entries ? <span className="cf-badge cf-badge--gray">{row.edited_entries} corrected</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="cf-card__meta">No hours recorded in this period.</p>}
        </div>

        <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
          <div className="cf-page__overline">Shifts</div>
          {entries.length ? (
            <table className="cf-table">
              <thead><tr><th>Staff</th><th>Outlet</th><th>In</th><th>Out</th><th>Breaks</th><th>Worked</th><th /></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <React.Fragment key={entry.id}>
                    <tr>
                      <td>{entry.user_name}{entry.source === "pin" ? " (PIN)" : entry.source === "manager" ? " (added)" : ""}</td>
                      <td>{outletName(entry.outlet_id)}</td>
                      <td>{formatDateTime(entry.clock_in_at)}</td>
                      <td>
                        {entry.clock_out_at ? formatTime(entry.clock_out_at) : entry.on_break ? "on break" : "working"}
                        {entry.missing_clock_out ? <span className="cf-badge cf-badge--amber" style={{ marginLeft: 4 }}>check</span> : null}
                      </td>
                      <td>{formatMinutes(entry.break_minutes)}</td>
                      <td>{formatMinutes(entry.worked_minutes)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {entry.open ? <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => closeShift(entry)}>Close</button> : null}{" "}
                        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setForm(toForm(entry))}>Correct</button>{" "}
                        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => removeShift(entry)}>Remove</button>{" "}
                        {entry.edits.length ? (
                          <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>History ({entry.edits.length})</button>
                        ) : null}
                      </td>
                    </tr>
                    {expanded === entry.id ? (
                      <tr>
                        <td colSpan={7}>
                          {entry.edits.map((edit, index) => (
                            <div className="cf-card__meta" key={index}>
                              {formatDateTime(edit.at)} · {edit.by_name || "Someone"} {edit.action}: {edit.reason}
                              {edit.before?.clock_in_at ? ` (was ${formatDateTime(edit.before.clock_in_at)} - ${edit.before.clock_out_at ? formatTime(edit.before.clock_out_at) : "open"})` : ""}
                            </div>
                          ))}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          ) : <p className="cf-card__meta">No shifts in this period.</p>}
        </div>

        <form className="cf-card cf-card--padded" onSubmit={savePin} style={{ marginTop: 12 }} data-testid="staff-pin-form">
          <div className="cf-page__overline">Time-clock PINs</div>
          <p className="cf-card__meta">
            Set a PIN for someone who uses the shared clock, or clear a PIN that is locked or known to others. Staff can change their own PIN on the Time Clock screen.
            {" "}Without a PIN: {team.filter((member) => !member.has_pin).map((member) => member.name).join(", ") || "nobody"}.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select aria-label="Staff member" className="cf-select" required style={{ flex: "2 1 160px" }} value={pinFor.userId} onChange={(event) => setPinFor({ ...pinFor, userId: event.target.value })}>
              <option value="">Choose</option>
              {team.map((member) => <option key={member.id} value={member.id}>{member.name}{member.has_pin ? " (has PIN)" : ""}</option>)}
            </select>
            <input aria-label="New PIN" autoComplete="off" className="cf-input" inputMode="numeric" maxLength={6} placeholder="New PIN (empty clears it)" style={{ flex: "1 1 140px" }} type="password" value={pinFor.pin} onChange={(event) => setPinFor({ ...pinFor, pin: event.target.value.replace(/\D/g, "") })} />
            <button className="cf-btn cf-btn--secondary" type="submit">{pinFor.pin ? "Set PIN" : "Clear PIN"}</button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default Attendance;
