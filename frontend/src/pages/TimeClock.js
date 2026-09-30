import React, { useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency } from "../lib/pos";
import { Link } from "react-router-dom";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { formatDateTime, formatMinutes, formatTime, presetRange, rangeQuery } from "../core/staff/staffTime";

const ACTIONS = {
  clock_in: { label: "Clock in", path: "clock-in" },
  break_start: { label: "Start break", path: "break/start" },
  break_end: { label: "End break", path: "break/end" },
  clock_out: { label: "Clock out", path: "clock-out" },
};
const actionsFor = (entry) => (!entry ? ["clock_in"] : entry.on_break ? ["break_end", "clock_out"] : ["break_start", "clock_out"]);

/** Everyone's own time clock and tips, plus a shared PIN clock for tills used by several people. */
export const TimeClock = () => {
  const { user } = useAuth();
  const { outlets, selectedOutletId } = useActiveOutlet();
  const [mine, setMine] = useState(null);
  const [tips, setTips] = useState(null);
  const [team, setTeam] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [outletId, setOutletId] = useState("");
  const [kiosk, setKiosk] = useState({ userId: "", pin: "" });
  const [pinForm, setPinForm] = useState({ current_password: "", pin: "" });
  const [declare, setDeclare] = useState({ amount: "", note: "" });
  const [payslips, setPayslips] = useState([]);

  const load = async () => {
    try {
      const week = rangeQuery(presetRange("this_week"));
      const [meResponse, tipsResponse, teamResponse, payslipResponse] = await Promise.all([
        axios.get(`${API_URL}/api/attendance/me?${week}`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/tips/me?${week}`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/attendance/team`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/payroll/my-payslips`, { withCredentials: true, skipCache: true }),
      ]);
      setPayslips(Array.isArray(apiData(payslipResponse)) ? apiData(payslipResponse) : []);
      setMine(apiData(meResponse) || null);
      setTips(apiData(tipsResponse) || null);
      setTeam(Array.isArray(apiData(teamResponse)) ? apiData(teamResponse) : []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { liveResources: ["attendance", "tips"], refreshOnFocus: true });

  const act = async (action) => {
    setBusy(true);
    try {
      const body = action === "clock_in" ? { outlet_id: outletId || selectedOutletId || undefined } : {};
      await axios.post(`${API_URL}/api/attendance/${ACTIONS[action].path}`, body, { withCredentials: true });
      toast.success(`${ACTIONS[action].label}: done`);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not update the time clock"));
    } finally {
      setBusy(false);
    }
  };

  const kioskAct = async (action) => {
    if (!kiosk.userId || !kiosk.pin) {
      toast.error("Choose your name and enter your PIN");
      return;
    }
    setBusy(true);
    try {
      const response = await axios.post(`${API_URL}/api/attendance/kiosk`, {
        user_id: kiosk.userId, pin: kiosk.pin, action, outlet_id: selectedOutletId || undefined,
      }, { withCredentials: true });
      const entry = apiData(response) || {};
      toast.success(`${entry.user_name || "Done"}: ${ACTIONS[action].label.toLowerCase()} at ${formatTime(new Date().toISOString())}`);
      setKiosk({ userId: "", pin: "" });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not update the time clock"));
      setKiosk((current) => ({ ...current, pin: "" }));
    } finally {
      setBusy(false);
    }
  };

  const savePin = async (event) => {
    event.preventDefault();
    try {
      await axios.put(`${API_URL}/api/attendance/me/pin`, pinForm, { withCredentials: true });
      toast.success("Your time-clock PIN is saved");
      setPinForm({ current_password: "", pin: "" });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not save the PIN"));
    }
  };

  const declareTip = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API_URL}/api/tips/declare`, { amount: Number(declare.amount), note: declare.note, outlet_id: selectedOutletId || undefined }, { withCredentials: true });
      toast.success("Cash tip recorded");
      setDeclare({ amount: "", note: "" });
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not record the tip"));
    }
  };

  const open = mine?.open_entry || null;
  const kioskPerson = team.find((member) => member.id === kiosk.userId);
  const assignedOutlets = (outlets || []).filter((outlet) => !user?.assigned_outlet_ids?.length || user.assigned_outlet_ids.includes(outlet.id));

  return (
    <Layout title="Time Clock">
      <div className="cf-page" data-testid="time-clock-page">
        <div className="cf-page__header">
          <div>
            <h1>Time Clock</h1>
            <p>Clock in and out, take breaks, and see your hours and tips for this week.</p>
          </div>
        </div>

        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        <div className="cf-grid-2" style={{ alignItems: "start" }}>
          <div className="cf-card cf-card--padded" data-testid="my-clock">
            <div className="cf-page__overline">My shift</div>
            <h2 style={{ margin: "6px 0" }}>
              {!open ? "Not clocked in" : open.on_break ? "On a break" : `Clocked in since ${formatTime(open.clock_in_at)}`}
            </h2>
            {open ? (
              <p className="cf-card__meta">
                Worked so far: {formatMinutes(open.worked_minutes)}
                {open.break_minutes ? ` · breaks ${formatMinutes(open.break_minutes)}` : ""}
                {open.outlet_id ? ` · ${(outlets || []).find((outlet) => outlet.id === open.outlet_id)?.name || "outlet"}` : ""}
              </p>
            ) : assignedOutlets.length > 1 ? (
              <div className="cf-field">
                <label htmlFor="clock-outlet">Outlet</label>
                <select className="cf-select" id="clock-outlet" value={outletId || selectedOutletId || ""} onChange={(event) => setOutletId(event.target.value)}>
                  <option value="">No specific outlet</option>
                  {assignedOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
                </select>
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {actionsFor(open).map((action) => (
                <button className={`cf-btn ${action === "clock_out" || action === "clock_in" ? "cf-btn--primary" : "cf-btn--secondary"}`} disabled={busy || user?.offline} key={action} type="button" onClick={() => act(action)}>
                  {ACTIONS[action].label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="cf-page__overline">This week: {formatMinutes(mine?.worked_minutes)}</div>
              {(mine?.entries || []).length ? (
                <table className="cf-table" style={{ marginTop: 6 }}>
                  <thead><tr><th>In</th><th>Out</th><th>Worked</th></tr></thead>
                  <tbody>
                    {mine.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDateTime(entry.clock_in_at)}</td>
                        <td>{entry.clock_out_at ? formatTime(entry.clock_out_at) : "open"}{entry.edits.length ? " (corrected)" : ""}</td>
                        <td>{formatMinutes(entry.worked_minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="cf-card__meta">No shifts yet this week.</p>}
            </div>
          </div>

          <div className="cf-card cf-card--padded" data-testid="my-tips">
            <div className="cf-page__overline">My tips this week</div>
            <div className="cf-metrics" style={{ marginTop: 8 }}>
              <div className="cf-metric"><div className="cf-metric__label">Earned</div><div className="cf-metric__value">{formatCurrency(tips?.earned)}</div></div>
              <div className="cf-metric"><div className="cf-metric__label">Paid to you</div><div className="cf-metric__value">{formatCurrency(tips?.paid)}</div></div>
              <div className="cf-metric"><div className="cf-metric__label">Still owed</div><div className="cf-metric__value">{formatCurrency(tips?.balance)}</div></div>
            </div>
            <p className="cf-card__meta" style={{ marginTop: 8 }}>
              Direct {formatCurrency(tips?.direct)} · Pool share {formatCurrency(tips?.pool_share)} · Cash declared {formatCurrency(tips?.declared)}
              {Number(tips?.pending) ? ` · Waiting for bill payment ${formatCurrency(tips.pending)}` : ""}
            </p>
            <form onSubmit={declareTip} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <input aria-label="Cash tip amount" className="cf-input" min="0.01" placeholder="Cash tip received" required step="0.01" style={{ flex: "1 1 120px" }} type="number" value={declare.amount} onChange={(event) => setDeclare({ ...declare, amount: event.target.value })} />
              <input aria-label="Tip note" className="cf-input" maxLength={300} placeholder="Note (optional)" style={{ flex: "2 1 160px" }} value={declare.note} onChange={(event) => setDeclare({ ...declare, note: event.target.value })} />
              <button className="cf-btn cf-btn--secondary" disabled={user?.offline} type="submit">Record cash tip</button>
            </form>
          </div>
        </div>

        <div className="cf-grid-2" style={{ alignItems: "start", marginTop: 16 }}>
          <div className="cf-card cf-card--padded" data-testid="shared-clock">
            <div className="cf-page__overline">Shared time clock</div>
            <p className="cf-card__meta">For a till used by several people: pick your name and enter your time-clock PIN.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <select aria-label="Your name" className="cf-select" style={{ flex: "2 1 160px" }} value={kiosk.userId} onChange={(event) => setKiosk({ userId: event.target.value, pin: "" })}>
                <option value="">Choose your name</option>
                {team.map((member) => (
                  <option key={member.id} value={member.id} disabled={!member.has_pin}>
                    {member.name}{member.clocked_in ? (member.on_break ? " (on break)" : " (in)") : ""}{member.has_pin ? "" : " - no PIN yet"}
                  </option>
                ))}
              </select>
              <input aria-label="PIN" autoComplete="off" className="cf-input" inputMode="numeric" maxLength={6} pattern="[0-9]*" placeholder="PIN" style={{ flex: "1 1 90px" }} type="password" value={kiosk.pin} onChange={(event) => setKiosk({ ...kiosk, pin: event.target.value.replace(/\D/g, "") })} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {(kioskPerson ? actionsFor(kioskPerson.clocked_in ? { on_break: kioskPerson.on_break } : null) : ["clock_in", "clock_out"]).map((action) => (
                <button className="cf-btn cf-btn--secondary" disabled={busy || user?.offline} key={action} type="button" onClick={() => kioskAct(action)}>{ACTIONS[action].label}</button>
              ))}
            </div>
          </div>

          {payslips.length ? (
            <div className="cf-card cf-card--padded" data-testid="my-payslips">
              <div className="cf-page__overline">My payslips</div>
              <table className="cf-table">
                <tbody>
                  {payslips.map((slip) => (
                    <tr key={slip.id}>
                      <td>{slip.period_label}</td>
                      <td>{formatCurrency(slip.net_pay)}</td>
                      <td>{slip.paid_at ? "Paid" : "Not paid yet"}</td>
                      <td><Link className="cf-btn cf-btn--secondary cf-btn--small" to={`/payslips/${slip.id}`}>View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <form className="cf-card cf-card--padded" onSubmit={savePin} data-testid="my-pin">
            <div className="cf-page__overline">My time-clock PIN {mine?.has_pin ? "(set)" : "(not set)"}</div>
            <p className="cf-card__meta">4 to 6 digits, not a run like 1234 or 1111. Five wrong tries lock it for 15 minutes.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <input aria-label="Current password" autoComplete="current-password" className="cf-input" placeholder="Your password" required style={{ flex: "2 1 160px" }} type="password" value={pinForm.current_password} onChange={(event) => setPinForm({ ...pinForm, current_password: event.target.value })} />
              <input aria-label="New PIN" autoComplete="off" className="cf-input" inputMode="numeric" maxLength={6} minLength={4} pattern="[0-9]{4,6}" placeholder="New PIN" required style={{ flex: "1 1 90px" }} type="password" value={pinForm.pin} onChange={(event) => setPinForm({ ...pinForm, pin: event.target.value.replace(/\D/g, "") })} />
              <button className="cf-btn cf-btn--secondary" disabled={user?.offline} type="submit">Save PIN</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
};

export default TimeClock;
