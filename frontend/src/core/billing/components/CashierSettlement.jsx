import React, { useState } from "react";
import axios from "axios";
import { getApiErrorMessage } from "../../../lib/apiErrors";
import { formatCurrency } from "../../../lib/pos";
const unwrap = (payload) => payload && Object.hasOwn(payload, "success") && Object.hasOwn(payload, "data") ? payload.data : payload;

export function CashierSettlement({ apiUrl, outletId }) {
  const [shift, setShift] = useState(null);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = async () => {
    setBusy(true); setError("");
    try {
      const config = { withCredentials: true, skipCache: true, params: { outlet_id: outletId } };
      const [current, past] = await Promise.all([
        axios.get(`${apiUrl}/api/billing/shifts/current`, config),
        axios.get(`${apiUrl}/api/billing/shifts/history`, config),
      ]);
      const currentShift = unwrap(current.data);
      setShift(currentShift); setHistory(unwrap(past.data) || []);
      setReport(currentShift ? unwrap((await axios.get(`${apiUrl}/api/billing/cash-drawer`, config)).data) : null);
      setLoaded(true);
    } catch (err) { setError(getApiErrorMessage(err, "Unable to load cashier settlement")); }
    finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const open = shift?.status === "open";
      await axios.post(`${apiUrl}/api/billing/shifts/${open ? "close" : "open"}`, {
        outlet_id: outletId, shift_id: shift?.id,
        [open ? "closing_cash" : "opening_cash"]: Number(cash),
      }, { withCredentials: true });
      setCash(""); await load();
    } catch (err) { setError(getApiErrorMessage(err, "Unable to save settlement. Refresh and try again.")); }
    finally { setBusy(false); }
  };
  return <details className="cf-card cf-card--padded" onToggle={(event) => { if (event.currentTarget.open && !loaded && !busy) load(); }}>
    <summary style={{ minHeight: 44, cursor: "pointer" }}>Cashier shift & settlement</summary>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="cf-btn cf-btn--secondary" disabled={busy} onClick={load}>Refresh settlement</button>
    {loaded && <>
      <p>{shift?.status === "open" ? `Shift opened ${new Date(shift.opened_at).toLocaleString()}` : "No open shift"}</p>
      {report && <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {[["Opening cash", report.opening_cash], ["Cash collected", report.cash_sales], ["Non-cash confirmed", report.non_cash_sales],
          ["Cash refunds", report.cash_refunds], ["Expected drawer", report.expected_cash], ["Pending confirmation", report.pending_payment_amount]].map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{formatCurrency(value || 0)}</dd></div>)}
      </dl>}
      <form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
        <label>{shift?.status === "open" ? "Counted cash in drawer" : "Opening cash"}
          <input className="cf-input" type="number" min="0" step="0.01" required value={cash} onChange={(event) => setCash(event.target.value)} style={{ minHeight: 44 }} />
        </label>
        <button className="cf-btn cf-btn--primary" style={{ minHeight: 44 }} disabled={busy || cash === "" || Boolean(error)}>{shift?.status === "open" ? "Close & save settlement" : "Open shift"}</button>
      </form>
      <p>Closing saves the counted cash and variance permanently. Later collections belong to the next shift.</p>
      <h3>Settlement history</h3>
      {!history.length && <p>No closed shifts for this outlet.</p>}
      {history.map((entry) => <details key={entry.id} style={{ padding: "12px 0" }}>
        <summary>{new Date(entry.closed_at).toLocaleString()} · Variance {formatCurrency(entry.variance || 0)}</summary>
        <p>Closed by {entry.closed_by_name || "Cashier"} · Counted {formatCurrency(entry.closing_cash)} · Expected {formatCurrency(entry.expected_cash)}</p>
        <p>Cash collected {formatCurrency(entry.report?.cash_sales || 0)} · Cash refunds {formatCurrency(entry.report?.cash_refunds || 0)}</p>
      </details>)}
    </>}
  </details>;
}
