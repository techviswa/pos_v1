import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { formatQuantity } from "../../lib/quantity";
import { useServerFeatureEnabled } from "../platform/store/serverFeatures";

const STATUS = { expired: "Expired — remove from use", expiring: "Expires within 14 days", ok: "OK", used_up: "Used up" };
const COLOR = { expired: "var(--cf-red)", expiring: "#b45309" };

/** Received lots with their expiry and the quantity probably still on hand (plan feature: batch tracking). */
export function BatchList({ apiUrl, inventory = [], refreshKey = 0 }) {
  const enabled = useServerFeatureEnabled("batch-tracking");
  const [data, setData] = useState(null);
  const [showUsed, setShowUsed] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { setData(apiData(await axios.get(`${apiUrl}/api/batch-tracking`, { withCredentials: true }))); }
    catch (error) { toast.error(getApiErrorMessage(error, "Batches could not be loaded")); }
  };
  useEffect(() => { if (enabled) void load(); }, [enabled, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return null;
  const rows = (data?.items || []).filter((row) => showUsed || row.status !== "used_up");
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      await axios.post(`${apiUrl}/api/batch-tracking`, { ...form, quantity: Number(form.quantity) }, { withCredentials: true });
      toast.success("Batch recorded"); setForm(null); await load();
    } catch (error) { toast.error(getApiErrorMessage(error, "Batch could not be recorded")); }
    finally { setBusy(false); }
  };
  return (
    <section className="cf-card cf-card--padded" style={{ marginBottom: 24 }} data-testid="batch-list">
      <div className="cf-card__title"><span>Batches and expiry</span></div>
      <p className="cf-card__meta">Lots are recorded when stock is received with a batch number. {data?.estimate_note}</p>
      {data ? <p role="status" style={{ fontWeight: 600, color: data.alerts.expired ? "var(--cf-red)" : undefined }}>
        {data.alerts.expired} expired · {data.alerts.expiring} expiring within 14 days
      </p> : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <label className="cf-card__meta"><input type="checkbox" checked={showUsed} onChange={(event) => setShowUsed(event.target.checked)} /> Show used-up lots</label>
        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setForm(form ? null : { inventory_id: "", batch_no: "", expiry_date: "", quantity: "" })}>{form ? "Cancel" : "Record a lot for stock already on hand"}</button>
      </div>
      {form ? (
        <form onSubmit={save} data-testid="batch-form" style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 12 }}>
          <select aria-label="Ingredient" className="cf-select" required value={form.inventory_id} onChange={(event) => setForm({ ...form, inventory_id: event.target.value })}>
            <option value="">Ingredient</option>
            {inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}
          </select>
          <input aria-label="Batch number" className="cf-input" maxLength={60} placeholder="Batch / lot number" required value={form.batch_no} onChange={(event) => setForm({ ...form, batch_no: event.target.value })} />
          <input aria-label="Expiry date" className="cf-input" type="date" required value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} />
          <input aria-label="Quantity" className="cf-input" min="0.001" step="any" type="number" placeholder="Quantity" required value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
          <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy} type="submit">Save lot (stock unchanged)</button>
        </form>
      ) : null}
      <div className="cf-table-wrap">
        <table className="cf-table">
          <thead><tr><th>Ingredient</th><th>Batch</th><th>Where</th><th>Received</th><th>Est. left</th><th>Expiry</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.inventory_name}</td>
                <td className="cf-table__mono">{row.batch_no}</td>
                <td>{row.location}</td>
                <td className="cf-table__mono">{formatQuantity(row.received_quantity, row.unit)}</td>
                <td className="cf-table__mono">{formatQuantity(row.estimated_remaining, row.unit)}</td>
                <td className="cf-table__mono">{row.expiry_date}{row.status !== "used_up" ? ` (${row.days_to_expiry < 0 ? `${-row.days_to_expiry} days ago` : `${row.days_to_expiry} days`})` : ""}</td>
                <td style={{ color: COLOR[row.status], fontWeight: COLOR[row.status] ? 600 : undefined }}>{STATUS[row.status] || row.status}</td>
              </tr>
            ))}
            {data && !rows.length ? <tr><td colSpan="7">No batches yet. Add a batch number when receiving stock.</td></tr> : null}
            {!data ? <tr><td colSpan="7">Loading...</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
