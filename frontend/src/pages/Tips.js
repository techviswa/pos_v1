import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { STAFF_ROLE_OPTIONS, formatCurrency, newClientKey } from "../lib/pos";
import { PeriodPicker } from "../core/staff/PeriodPicker";
import { customRange, downloadCsv, formatDateTime, presetRange, rangeQuery, toDateInput } from "../core/staff/staffTime";

const STATE_LABELS = { counted: "Counted", pending: "Bill not paid yet", cancelled: "Bill voided/refunded", void: "Voided" };
const SOURCE_LABELS = { bill: "Bill", qr: "QR order", declared: "Cash declared" };

/** Tips for a period: who earned what (direct, declared, share of the pool by hours), payouts, corrections. */
export const Tips = () => {
  const today = toDateInput(new Date());
  const [period, setPeriod] = useState({ preset: "this_week", fromDate: today, toDate: today });
  const [outletFilter, setOutletFilter] = useState("");
  const [data, setData] = useState(null);
  const [team, setTeam] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [payout, setPayout] = useState(null);
  const [declare, setDeclare] = useState({ user_id: "", amount: "", note: "" });

  const range = useMemo(
    () => (period.preset === "custom" ? customRange(period.fromDate, period.toDate) : presetRange(period.preset)),
    [period],
  );
  const query = `${rangeQuery(range)}${outletFilter ? `&outlet_id=${encodeURIComponent(outletFilter)}` : ""}`;

  const load = async () => {
    try {
      const [summaryResponse, teamResponse, outletResponse, settingsResponse] = await Promise.all([
        axios.get(`${API_URL}/api/tips/summary?${query}`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/attendance/team`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/outlets`, { withCredentials: true }),
        axios.get(`${API_URL}/api/tips/settings`, { withCredentials: true, skipCache: true }),
      ]);
      setData(apiData(summaryResponse) || null);
      setTeam(Array.isArray(apiData(teamResponse)) ? apiData(teamResponse) : []);
      setOutlets(Array.isArray(outletResponse.data) ? outletResponse.data : apiData(outletResponse) || outletResponse.data?.items || []);
      setSettings(apiData(settingsResponse) || null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { liveResources: ["tips", "bills", "attendance"], refreshOnFocus: true });
  const reloadForQuery = useEffectEvent(() => load());
  const lastQueryRef = useRef(query);
  useEffect(() => {
    if (lastQueryRef.current === query) return;
    lastQueryRef.current = query;
    reloadForQuery();
  }, [query, reloadForQuery]);

  const run = async (request, success, failure) => {
    try {
      await request();
      toast.success(success);
      await load();
      return true;
    } catch (error) {
      toast.error(getApiErrorMessage(error, failure));
      return false;
    }
  };

  const openPayout = (row) => setPayout({ user_id: row.user_id, name: row.name, amount: String(row.balance), method: "Cash", note: "", client_request_id: newClientKey() });
  const submitPayout = async (event) => {
    event.preventDefault();
    const done = await run(() => axios.post(`${API_URL}/api/tips/payouts`, {
      ...payout, amount: Number(payout.amount), from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString(),
    }, { withCredentials: true }), `Paid ${payout.name}`, "Could not record the payout");
    if (done) setPayout(null);
  };

  const reassign = (tip, value) => run(
    () => axios.put(`${API_URL}/api/tips/${tip.id}/recipient`, value === "pool" ? { pooled: true } : { user_id: value }, { withCredentials: true }),
    "Tip reassigned", "Could not reassign the tip",
  );
  const voidTip = (tip) => {
    const reason = window.prompt("Void this tip? Reason:");
    if (reason) run(() => axios.post(`${API_URL}/api/tips/${tip.id}/void`, { reason }, { withCredentials: true }), "Tip voided", "Could not void the tip");
  };
  const voidPayout = (row) => {
    const reason = window.prompt(`Void the payout of ${formatCurrency(row.amount)} to ${row.user_name}? Reason:`);
    if (reason) run(() => axios.post(`${API_URL}/api/tips/payouts/${row.id}/void`, { reason }, { withCredentials: true }), "Payout voided", "Could not void the payout");
  };
  const submitDeclare = async (event) => {
    event.preventDefault();
    const body = declare.user_id === "pool" ? { pooled: true } : { user_id: declare.user_id };
    const done = await run(() => axios.post(`${API_URL}/api/tips/declare`, {
      ...body, amount: Number(declare.amount), note: declare.note, outlet_id: outletFilter || undefined,
    }, { withCredentials: true }), "Tip recorded", "Could not record the tip");
    if (done) setDeclare({ user_id: "", amount: "", note: "" });
  };
  const togglePoolRole = (role) => {
    const roles = settings.tip_pool_roles.includes(role) ? settings.tip_pool_roles.filter((entry) => entry !== role) : [...settings.tip_pool_roles, role];
    run(() => axios.put(`${API_URL}/api/tips/settings`, { tip_pool_roles: roles }, { withCredentials: true }), "Tip pool updated", "Could not update the tip pool");
  };

  const businessWide = !outletFilter;
  const totals = data?.totals || {};
  const exportCsv = () => downloadCsv(`tips-${toDateInput(range.from)}.csv`, [
    ["Staff", "Role", "Hours", "Direct", "Cash declared", "Pool share", "Earned", "Paid", "Balance", "Waiting for payment"],
    ...(data?.staff || []).map((row) => [row.name, row.role, row.hours, row.direct, row.declared, row.pool_share, row.earned, row.paid ?? "", row.balance ?? "", row.pending]),
  ]);

  return (
    <Layout title="Tips">
      <div className="cf-page" data-testid="tips-page">
        <div className="cf-page__header">
          <div>
            <h1>Tips</h1>
            <p>Tips are paid with bills but never taxed. A tip goes to one person or to the pool; the pool is shared by hours clocked on the Time Clock. A bill's tip counts once the bill is fully paid.</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" disabled={!data?.staff?.length} type="button" onClick={exportCsv}>Export CSV</button>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <PeriodPicker value={period} onChange={setPeriod} />
          <select aria-label="Outlet" className="cf-select" style={{ width: "auto" }} value={outletFilter} onChange={(event) => setOutletFilter(event.target.value)}>
            <option value="">All outlets</option>
            {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
          </select>
          {!businessWide ? <span className="cf-card__meta">Payouts and balances cover all outlets; choose "All outlets" to pay out.</span> : null}
        </div>

        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        <div className="cf-metrics" style={{ marginTop: 12 }}>
          <div className="cf-metric"><div className="cf-metric__label">Direct tips</div><div className="cf-metric__value">{formatCurrency(totals.direct)}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Pooled</div><div className="cf-metric__value">{formatCurrency(totals.pooled)}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Cash declared</div><div className="cf-metric__value">{formatCurrency(totals.declared)}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Waiting for bill payment</div><div className="cf-metric__value">{formatCurrency(totals.pending)}</div></div>
          {businessWide ? <div className="cf-metric"><div className="cf-metric__label">Paid out</div><div className="cf-metric__value">{formatCurrency(totals.paid)}</div></div> : null}
        </div>
        {Number(totals.undistributed) ? (
          <div className="cf-card cf-card--padded" role="alert" style={{ marginTop: 8 }}>
            {formatCurrency(totals.undistributed)} of pooled tips could not be shared because nobody in the pool roles clocked any hours in this period. Add the missing shifts on the Attendance screen.
          </div>
        ) : null}

        {payout ? (
          <form className="cf-card cf-card--padded" onSubmit={submitPayout} style={{ display: "grid", gap: 10, marginTop: 12 }} data-testid="payout-form">
            <strong>Pay tips to {payout.name} for {formatDateTime(range.from)} - {formatDateTime(range.to)}</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input aria-label="Payout amount" className="cf-input" min="0.01" required step="0.01" style={{ flex: "1 1 120px" }} type="number" value={payout.amount} onChange={(event) => setPayout({ ...payout, amount: event.target.value })} />
              <select aria-label="Payout method" className="cf-select" style={{ flex: "1 1 120px" }} value={payout.method} onChange={(event) => setPayout({ ...payout, method: event.target.value })}>
                {["Cash", "UPI", "Bank transfer", "Payroll"].map((method) => <option key={method} value={method}>{method}</option>)}
              </select>
              <input aria-label="Payout note" className="cf-input" maxLength={300} placeholder="Note (optional)" style={{ flex: "2 1 160px" }} value={payout.note} onChange={(event) => setPayout({ ...payout, note: event.target.value })} />
            </div>
            <div className="cf-dialog-actions">
              <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setPayout(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary" type="submit">Record payout</button>
            </div>
          </form>
        ) : null}

        <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
          <div className="cf-page__overline">By person</div>
          {(data?.staff || []).length ? (
            <table className="cf-table">
              <thead>
                <tr><th>Staff</th><th>Hours</th><th>Direct</th><th>Declared</th><th>Pool share</th><th>Earned</th>{businessWide ? <><th>Paid</th><th>Owed</th><th /></> : null}</tr>
              </thead>
              <tbody>
                {data.staff.map((row) => (
                  <tr key={row.user_id || row.name}>
                    <td>{row.name}{row.role ? ` (${row.role})` : ""}{Number(row.pending) ? <div className="cf-card__meta">+{formatCurrency(row.pending)} when bills are paid</div> : null}</td>
                    <td>{row.hours}</td>
                    <td>{formatCurrency(row.direct)}</td>
                    <td>{formatCurrency(row.declared)}</td>
                    <td>{formatCurrency(row.pool_share)}</td>
                    <td><strong>{formatCurrency(row.earned)}</strong></td>
                    {businessWide ? (
                      <>
                        <td>{formatCurrency(row.paid)}</td>
                        <td>{formatCurrency(row.balance)}{row.partially_paid_overlap ? <div className="cf-card__meta">A payout overlaps this period</div> : null}</td>
                        <td>{row.user_id && row.balance > 0 && !row.partially_paid_overlap ? <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => openPayout(row)}>Pay out</button> : null}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="cf-card__meta">No tips or hours in this period.</p>}
        </div>

        <div className="cf-grid-2" style={{ alignItems: "start", marginTop: 12 }}>
          <form className="cf-card cf-card--padded" onSubmit={submitDeclare} data-testid="declare-tip-form">
            <div className="cf-page__overline">Record a cash tip</div>
            <p className="cf-card__meta">For cash handed over outside a bill, e.g. a tip jar (pool) or cash given to one person.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select aria-label="Tip for" className="cf-select" required style={{ flex: "2 1 160px" }} value={declare.user_id} onChange={(event) => setDeclare({ ...declare, user_id: event.target.value })}>
                <option value="">Choose</option>
                <option value="pool">Shared tip pool</option>
                {team.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.role})</option>)}
              </select>
              <input aria-label="Amount" className="cf-input" min="0.01" required step="0.01" style={{ flex: "1 1 100px" }} type="number" value={declare.amount} onChange={(event) => setDeclare({ ...declare, amount: event.target.value })} />
              <input aria-label="Note" className="cf-input" maxLength={300} placeholder="Note" style={{ flex: "2 1 140px" }} value={declare.note} onChange={(event) => setDeclare({ ...declare, note: event.target.value })} />
              <button className="cf-btn cf-btn--secondary" type="submit">Record</button>
            </div>
          </form>
          <div className="cf-card cf-card--padded" data-testid="tip-pool-settings">
            <div className="cf-page__overline">Who shares the pool</div>
            <p className="cf-card__meta">Pooled tips are split between these roles by hours worked at the outlet where the tip was taken.</p>
            <div className="cf-checkbox-row">
              {STAFF_ROLE_OPTIONS.map((role) => (
                <label key={role}>
                  <input checked={Boolean(settings?.tip_pool_roles?.includes(role))} disabled={!settings || !businessWide} type="checkbox" onChange={() => togglePoolRole(role)} /> {role}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
          <div className="cf-page__overline">Tips</div>
          {(data?.tips || []).length ? (
            <table className="cf-table">
              <thead><tr><th>When</th><th>From</th><th>Amount</th><th>For</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.tips.map((tip) => (
                  <tr key={tip.id}>
                    <td>{formatDateTime(tip.created_at)}</td>
                    <td>{SOURCE_LABELS[tip.source] || tip.source}{tip.invoice_number ? ` ${tip.invoice_number}` : ""}{tip.note ? <div className="cf-card__meta">{tip.note}</div> : null}</td>
                    <td>{formatCurrency(tip.amount)}</td>
                    <td>
                      {tip.state === "void" ? (tip.pooled ? "Pool" : tip.recipient_name) : (
                        <select aria-label="Tip for" className="cf-select" value={tip.pooled ? "pool" : tip.user_id || ""} onChange={(event) => reassign(tip, event.target.value)}>
                          <option value="pool">Shared tip pool</option>
                          {!tip.pooled && tip.user_id && !team.some((member) => member.id === tip.user_id) ? <option value={tip.user_id}>{tip.recipient_name}</option> : null}
                          {!tip.pooled && !tip.user_id ? <option value="">{tip.recipient_name || "Former staff"}</option> : null}
                          {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td>{STATE_LABELS[tip.state] || tip.state}{tip.void_reason ? <div className="cf-card__meta">{tip.void_reason}</div> : null}</td>
                    <td>{tip.state !== "void" ? <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => voidTip(tip)}>Void</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="cf-card__meta">No tips in this period.</p>}
        </div>

        {businessWide && (data?.payouts || []).length ? (
          <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
            <div className="cf-page__overline">Payouts touching this period</div>
            <table className="cf-table">
              <thead><tr><th>Paid</th><th>To</th><th>Period</th><th>Amount</th><th>Method</th><th /></tr></thead>
              <tbody>
                {data.payouts.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}{row.paid_by_name ? ` by ${row.paid_by_name}` : ""}</td>
                    <td>{row.user_name}</td>
                    <td>{formatDateTime(row.period_from)} - {formatDateTime(row.period_to)}</td>
                    <td>{formatCurrency(row.amount)}</td>
                    <td>{row.method}{row.note ? <div className="cf-card__meta">{row.note}</div> : null}</td>
                    <td><button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => voidPayout(row)}>Void</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

export default Tips;
