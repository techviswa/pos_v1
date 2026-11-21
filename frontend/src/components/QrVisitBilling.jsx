import React, { useState } from "react";
import axios from "axios";
import { API_URL } from "../contexts/AuthContext";
import { apiData } from "../lib/apiData";
import { formatCurrency, newClientKey } from "../lib/pos";

export function QrVisitBilling({ orderId, onIssued, onClose }) {
  const [visit, setVisit] = useState(null), [selected, setSelected] = useState([]), [count, setCount] = useState(2);
  const [quantities, setQuantities] = useState({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [request, setRequest] = useState(null);
  const base = `${API_URL}/api/public/qr/checkout/${orderId}/visit`;
  const load = async () => {
    setBusy(true); setError("");
    try { const data = apiData(await axios.get(base, { withCredentials: true, skipCache: true })); setVisit(data); setSelected(data.orders.map((order) => order.id)); setQuantities({}); setRequest(null); }
    catch (failure) { setError(failure.response?.data?.error?.message || "Unable to load this table visit."); }
    finally { setBusy(false); }
  };
  React.useEffect(() => { load(); /* The parent keys this component by order. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  const orders = (visit?.orders || []).filter((order) => selected.includes(order.id));
  const lines = orders.flatMap((order) => order.items);
  const values = (line) => quantities[line.id] || Array.from({ length: count }, (_, i) => i === 0 ? line.quantity : 0);
  const valid = lines.length > 0 && lines.every((line) => values(line).every((n) => Number.isInteger(n) && n >= 0) && values(line).reduce((a, b) => a + b, 0) === line.quantity);
  const issue = async (split) => {
    const groups = split ? Array.from({ length: count }, (_, i) => ({ items: lines.filter((line) => values(line)[i] > 0).map((line) => ({ item_id: line.id, quantity: values(line)[i] })) })).filter((group) => group.items.length)
      : [{ items: lines.map((line) => ({ item_id: line.id, quantity: line.quantity })) }];
    if (!groups.length || (split && (!valid || groups.length < 2))) { setError("Assign every quantity exactly once to at least two invoices."); return; }
    const fingerprint = JSON.stringify([selected, groups]);
    const key = request?.fingerprint === fingerprint ? request.key : newClientKey();
    setRequest({ fingerprint, key }); setBusy(true); setError("");
    try { await axios.post(base, { order_ids: selected, groups, client_request_id: key }, { withCredentials: true, timeout: 65000 }); onIssued(); }
    catch (failure) { setError(failure.response?.data?.error?.message || "Issuing was not confirmed. Retry the same allocation to recover its result safely."); }
    finally { setBusy(false); }
  };
  return <section className="cf-card cf-card--padded" aria-label="Combine rounds and split invoices">
    <h3>Combine rounds / split by items</h3>
    <p>Select accepted rounds from this table visit. Issued invoices cannot be repartitioned here. Each guest's order link will show the invoice(s) containing their items.</p>
    <p>Service charges and tips are distributed by each round's item value, keeping every paise. Each invoice calculates its own tax. Clear any requested loyalty redemption first; it cannot be transferred between guests.</p>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={busy} onClick={load}>Reload visit</button> <button type="button" disabled={busy} onClick={onClose}>Close allocation</button>
    {(visit?.orders || []).map((order) => <div key={order.id}><label><input type="checkbox" disabled={busy} checked={selected.includes(order.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, order.id] : selected.filter((id) => id !== order.id))} />{order.customer_name} · {new Date(order.created_at).toLocaleTimeString()} · {order.items.reduce((n, line) => n + line.quantity, 0)} items</label></div>)}
    {visit && !visit.orders.length ? <p>No accepted, unbilled orders in this visit.</p> : null}
    <button className="cf-btn cf-btn--primary" type="button" disabled={busy || !lines.length} onClick={() => issue(false)}>Issue one combined unpaid invoice</button>
    <h4>Or assign items to separate invoices</h4>
    <label>Number of invoices <select value={count} disabled={busy} onChange={(event) => { setCount(Number(event.target.value)); setQuantities({}); }}>{Array.from({ length: 9 }, (_, i) => i + 2).map((n) => <option key={n}>{n}</option>)}</select></label>
    <div style={{ overflowX: "auto" }}><table className="cf-table"><thead><tr><th>Ordered item</th>{Array.from({ length: count }, (_, i) => <th key={i}>Invoice {i + 1}</th>)}<th>Assigned</th></tr></thead><tbody>
      {lines.map((line) => <tr key={line.id}><td>{line.name} {line.variation} × {line.quantity} ({formatCurrency(line.price)} each)</td>{values(line).map((quantity, i) => <td key={i}><input aria-label={`${line.name} ${line.id} invoice ${i + 1} quantity`} type="number" min="0" max={line.quantity} step="1" disabled={busy} style={{ width: 64 }} value={quantity} onChange={(event) => { const next = [...values(line)]; next[i] = Number(event.target.value); setQuantities({ ...quantities, [line.id]: next }); }} /></td>)}<td>{values(line).reduce((a, b) => a + b, 0)} / {line.quantity}</td></tr>)}
    </tbody></table></div>
    <button className="cf-btn" type="button" disabled={busy || !valid} onClick={() => issue(true)}>Issue separate unpaid invoices</button>
    <p>No payment is recorded by issuing. Guests can then pay equal or custom shares of their issued invoice, or pay staff.</p>
  </section>;
}
