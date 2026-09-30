import React, { useState } from "react";
import axios from "axios";
import { useAuth } from "../../contexts/AuthContext";
import { getApiErrorMessage } from "../../lib/apiErrors";

const money = (value) => Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function InventoryAccounting({ apiUrl, onChanged, inventory = [] }) {
  const { user } = useAuth();
  const [valuation, setValuation] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [receiptId, setReceiptId] = useState("");
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receiving, setReceiving] = useState({ vendor_name: "", vendor_bill_number: "", outlet_id: "", stock_location: "central" });
  const [receiptLines, setReceiptLines] = useState([{ inventory_id: "", quantity: "", unit_cost: "" }]);
  const [receivingKey, setReceivingKey] = useState(null);
  const [receiptUncertain, setReceiptUncertain] = useState(false);
  const canReturn = ["Owner", "Manager"].includes(user?.role);
  const receipt = receipts.find((row) => row.id === receiptId);
  const load = async () => {
    setBusy(true); setMessage("");
    try {
      const [values, documents] = await Promise.all([
        axios.get(`${apiUrl}/api/inventory/accounting/valuation`, { withCredentials: true }),
        axios.get(`${apiUrl}/api/inventory/accounting/receipts`, { withCredentials: true }),
      ]);
      setValuation(values.data); setReceipts(documents.data); setQuantities({}); setRequestId(null); setUncertain(false);
      setReceiptUncertain(false); setReceivingKey(null); setReceiptLines([{ inventory_id: "", quantity: "", unit_cost: "" }]);
    } catch (error) { setMessage(getApiErrorMessage(error, "Inventory accounting could not be loaded.")); }
    finally { setBusy(false); }
  };
  const receive = async (event) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const key = receivingKey || window.crypto.randomUUID(); setReceivingKey(key);
    try {
      await axios.post(`${apiUrl}/api/inventory/purchase-receivings`, { ...receiving, request_id: key,
        items: receiptLines.map((line) => ({ inventory_id: line.inventory_id, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost) })),
      }, { withCredentials: true });
      await load(); onChanged?.(); setMessage("Purchase received and stock valuation updated.");
    } catch (error) { setReceiptUncertain(true); setMessage(`${getApiErrorMessage(error, "Receiving could not be confirmed.")} Retry the same request, or refresh and check receipts before creating another.`); }
    finally { setBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const key = requestId || window.crypto.randomUUID(); setRequestId(key);
    try {
      const response = await axios.post(`${apiUrl}/api/inventory/accounting/receipts/${receiptId}/returns`, {
        request_id: key, reason, items: Object.entries(quantities).filter(([, quantity]) => Number(quantity) > 0)
          .map(([movement_id, quantity]) => ({ movement_id, quantity: Number(quantity) })),
      }, { withCredentials: true });
      await load(); onChanged?.();
      setMessage(`Return recorded. Purchase credit: ${money(response.data.credit_amount)}. Stock value removed: ${money(response.data.stock_value_removed)}. Payment settlement is separate.`);
    } catch (error) {
      setUncertain(true);
      setMessage(`${getApiErrorMessage(error, "Return could not be confirmed.")} Reload receipts to check the result, or retry the same request.`);
    } finally { setBusy(false); }
  };
  return <section className="cf-card cf-card--padded" style={{ marginBottom: 24 }}>
    <h2>Stock valuation and supplier returns</h2>
    <p>Moving weighted-average cost by location. Transfers awaiting receipt are shown separately. Supplier credits use the original purchase price.</p>
    <button className="cf-btn cf-btn--secondary" disabled={busy} onClick={load}>Load / refresh accounting</button>
    {message && <p role="status">{message}</p>}
    {valuation && <>
      <p>On-hand value: <strong>{money(valuation.totals.on_hand_value)}</strong> · In transit: <strong>{money(valuation.totals.in_transit_value)}</strong></p>
      <p>Reconciliation differences: {valuation.totals.differences} · Unverified opening balances: {valuation.totals.unverified_opening_balances} · Unvalued transfers: {valuation.totals.unvalued_transfers}</p>
      <div style={{ overflowX: "auto" }}><table className="cf-table"><thead><tr><th>Ingredient</th><th>Location</th><th>Quantity</th><th>Unit cost</th><th>Value</th><th>Reconciliation</th></tr></thead>
        <tbody>{valuation.rows.map((row) => <tr key={`${row.inventory_id}:${row.outlet_id}`}><td>{row.name}</td><td>{row.location}</td><td>{row.quantity} {row.unit}</td><td>{money(row.unit_cost)}{row.estimated_cost ? " (estimated)" : ""}</td><td>{money(row.value)}</td><td>{row.reconciliation.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>
      <details style={{ marginTop: 20 }}><summary>Receive a purchase</summary><form onSubmit={receive}>
        <fieldset disabled={busy || receiptUncertain}>
          <label>Supplier<input className="cf-input" required value={receiving.vendor_name} onChange={(event) => setReceiving({ ...receiving, vendor_name: event.target.value })} /></label>
          <label>Supplier bill reference<input className="cf-input" value={receiving.vendor_bill_number} onChange={(event) => setReceiving({ ...receiving, vendor_bill_number: event.target.value })} /></label>
          <label>Outlet for this receipt<select className="cf-input" required value={receiving.outlet_id} onChange={(event) => setReceiving({ ...receiving, outlet_id: event.target.value })}><option value="">Select outlet</option>{valuation.locations.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label>
          <label>Receive stock into<select className="cf-input" value={receiving.stock_location} onChange={(event) => setReceiving({ ...receiving, stock_location: event.target.value })}><option value="central">Central store</option><option value="outlet">Selected outlet</option></select></label>
          {receiptLines.map((line, index) => <div key={index} style={{ marginTop: 12 }}>
            <label>Ingredient<select className="cf-input" required value={line.inventory_id} onChange={(event) => setReceiptLines(receiptLines.map((entry, position) => position === index ? { ...entry, inventory_id: event.target.value } : entry))}><option value="">Select ingredient</option>{inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label>
            <label>Quantity<input className="cf-input" type="number" min="0.000001" step="any" required value={line.quantity} onChange={(event) => setReceiptLines(receiptLines.map((entry, position) => position === index ? { ...entry, quantity: event.target.value } : entry))} /></label>
            <label>Cost per inventory unit<input className="cf-input" type="number" min="0" step="any" required value={line.unit_cost} onChange={(event) => setReceiptLines(receiptLines.map((entry, position) => position === index ? { ...entry, unit_cost: event.target.value } : entry))} /></label>
            {receiptLines.length > 1 && <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setReceiptLines(receiptLines.filter((_, position) => position !== index))}>Remove line</button>}
          </div>)}
          <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setReceiptLines([...receiptLines, { inventory_id: "", quantity: "", unit_cost: "" }])}>Add receipt line</button>
        </fieldset>
        <button className="cf-btn cf-btn--primary" disabled={busy} style={{ minHeight: 44, marginTop: 12 }}>Receive purchase</button>
      </form></details>
      {canReturn && <form data-testid="supplier-return-form" onSubmit={submit} style={{ marginTop: 24 }}>
        <h3>Return part or all of a purchase receipt</h3>
        <label>Receipt<select className="cf-input" required value={receiptId} disabled={busy || uncertain} onChange={(event) => { setReceiptId(event.target.value); setQuantities({}); setRequestId(null); }}>
          <option value="">Select a receipt (latest 100)</option>{receipts.map((row) => <option key={row.id} value={row.id}>{row.vendor_bill_number || row.id} · {row.vendor_name || "Supplier"} · {new Date(row.created_at).toLocaleDateString()}</option>)}
        </select></label>
        {receipt?.items.map((line) => {
          const returned = (receipt.returns || []).flatMap((entry) => entry.items).filter((entry) => entry.receipt_movement_id === line.movement_id).reduce((sum, entry) => sum + entry.quantity, 0);
          const remaining = Math.max(0, line.quantity - returned);
          return <label key={line.movement_id} style={{ display: "block", marginTop: 12 }}>{line.inventory_name} — returnable {remaining} {line.unit}
            <input className="cf-input" type="number" min="0" max={remaining} step="any" disabled={busy || uncertain || !remaining} value={quantities[line.movement_id] || ""} onChange={(event) => setQuantities({ ...quantities, [line.movement_id]: event.target.value })} />
          </label>;
        })}
        <label>Return reason<input className="cf-input" required maxLength={500} disabled={busy || uncertain} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button className="cf-btn cf-btn--primary" style={{ marginTop: 12, minHeight: 44 }} disabled={busy || !receipt || !reason.trim() || !Object.values(quantities).some((quantity) => Number(quantity) > 0)}>Record supplier return</button>
        {!!receipt?.returns?.length && <ul>{receipt.returns.map((entry) => <li key={entry.id}>{new Date(entry.returned_at).toLocaleString()} · Credit {money(entry.credit_amount)} · {entry.reason}</li>)}</ul>}
      </form>}
    </>}
  </section>;
}
