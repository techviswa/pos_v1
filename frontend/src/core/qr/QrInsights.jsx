import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_URL } from "../../lib/apiUrl";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { formatCurrency } from "../../lib/pos";
import { useActiveOutlet } from "../outlets/store/ActiveOutletContext";
import { KIND_LABELS } from "./SmartCodes";

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/** Per-code performance: scans, approved orders and their value per table code, smart-code scans, busy hours. */
export function QrInsights() {
  const { selectedOutletId } = useActiveOutlet();
  const [range, setRange] = useState({ from: day(-29), to: day(0) });
  const [state, setState] = useState({ data: null, error: "" });
  const request = useRef(0);
  useEffect(() => {
    const ticket = ++request.current;
    setState((current) => ({ ...current, error: "" }));
    axios.get(`${API_URL}/api/qr-studio/insights`, { params: { ...range, ...(selectedOutletId ? { outlet_id: selectedOutletId } : {}) }, withCredentials: true, skipCache: true })
      .then((response) => { if (ticket === request.current) setState({ data: apiData(response), error: "" }); })
      .catch((error) => { if (ticket === request.current) setState({ data: null, error: getApiErrorMessage(error, "QR performance could not be loaded") }); });
  }, [range, selectedOutletId]);
  const { data, error } = state;
  const peak = Math.max(1, ...(data?.hours || []).map((row) => row.scans));

  return (
    <section className="cf-card cf-card--padded" style={{ marginBottom: 24 }} data-testid="qr-insights" aria-label="QR performance">
      <div className="cf-card__title"><span>QR performance</span></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }}>
        <label className="cf-card__meta">From <input className="cf-input" type="date" value={range.from} max={range.to} onChange={(event) => event.target.value && setRange({ ...range, from: event.target.value })} /></label>
        <label className="cf-card__meta">To <input className="cf-input" type="date" value={range.to} min={range.from} onChange={(event) => event.target.value && setRange({ ...range, to: event.target.value })} /></label>
        <span className="cf-card__meta">{selectedOutletId ? "Selected outlet" : "All outlets you can see"} · times in {data?.range?.timezone || "Asia/Kolkata"}</span>
      </div>
      {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading…</p> : <>
        <div className="cf-metrics">
          <div className="cf-metric"><div className="cf-metric__value">{data.totals.table_scans}</div><div className="cf-metric__label">Table code scans</div></div>
          <div className="cf-metric"><div className="cf-metric__value">{data.totals.approved_orders}</div><div className="cf-metric__label">Approved QR orders</div></div>
          <div className="cf-metric"><div className="cf-metric__value">{formatCurrency(data.totals.order_value)}</div><div className="cf-metric__label">Order value</div></div>
          <div className="cf-metric"><div className="cf-metric__value">{data.totals.conversion_percent == null ? "—" : `${data.totals.conversion_percent}%`}</div><div className="cf-metric__label">Orders per scan</div></div>
          <div className="cf-metric"><div className="cf-metric__value">{data.totals.smart_code_scans}</div><div className="cf-metric__label">Smart code scans</div></div>
        </div>
        <div className="cf-field">
          <label>Scans by hour of day</label>
          <div role="img" aria-label="Scans by hour of day" style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", alignItems: "end", gap: 2, height: 90 }}>
            {data.hours.map((row) => <div key={row.hour} title={`${String(row.hour).padStart(2, "0")}:00 — ${row.scans} scans`} style={{ height: `${Math.max(2, (row.scans / peak) * 100)}%`, background: row.scans ? "var(--cf-accent, #b45309)" : "var(--cf-border, #e5e7eb)", borderRadius: 2 }} />)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }} className="cf-card__meta"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </div>
        <div className="cf-table-wrap" style={{ marginTop: 12 }}>
          <table className="cf-table">
            <thead><tr><th>Table code</th><th>Scans</th><th>Approved orders</th><th>Order value</th><th>Orders per scan</th></tr></thead>
            <tbody>
              {data.tables.map((row) => <tr key={row.table_id}><td>{row.name}{row.area_name ? <span className="cf-card__meta"> · {row.area_name}</span> : null}{row.active ? "" : <span className="cf-card__meta"> (off)</span>}</td><td className="cf-table__mono">{row.scans}</td><td className="cf-table__mono">{row.orders}</td><td className="cf-table__mono">{formatCurrency(row.order_value)}</td><td className="cf-table__mono">{row.conversion_percent == null ? "—" : `${row.conversion_percent}%`}</td></tr>)}
              {!data.tables.length ? <tr><td colSpan="5">No table codes in this view.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="cf-table-wrap" style={{ marginTop: 12 }}>
          <table className="cf-table">
            <thead><tr><th>Smart code</th><th>Type</th><th>Scans</th><th>Devices</th></tr></thead>
            <tbody>
              {data.links.map((row) => <tr key={row.id}><td>{row.name}{row.active ? "" : <span className="cf-card__meta"> (off)</span>}</td><td>{KIND_LABELS[row.kind]}</td><td className="cf-table__mono">{row.scans}</td><td className="cf-table__mono">{row.visitors}</td></tr>)}
              {!data.links.length ? <tr><td colSpan="4">No smart codes in this view.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <ul className="cf-card__meta" style={{ marginTop: 8 }}>{Object.values(data.definitions).map((text) => <li key={text}>{text}</li>)}</ul>
      </>}
    </section>
  );
}
