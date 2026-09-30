import React, { useState } from "react";
import axios from "axios";
import { getApiErrorMessage } from "../../../lib/apiErrors";

export function StockReversal({ bill, apiUrl }) {
  const [reason, setReason] = useState("");
  const [unprepared, setUnprepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [partial, setPartial] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [requestId] = useState(() => window.crypto.randomUUID());
  const [submitted, setSubmitted] = useState(false);
  const fullyReturned = ["void", "refunded"].includes(bill.status);
  if (!fullyReturned && !(Number(bill.refunded_amount) > 0)) return null;
  const products = [...new Map((bill.items || []).filter((item) => item.product_id || item.productId).map((item) => [item.product_id || item.productId, item])).entries()];
  const useSelection = partial || !fullyReturned;
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setSubmitted(true); setMessage("");
    try {
      await axios.post(`${apiUrl}/api/billing/${bill.id}/stock-reversal`, { reason, unprepared,
        ...(useSelection ? { request_id: requestId, products: Object.entries(quantities).filter(([, quantity]) => Number(quantity) > 0).map(([product_id, quantity]) => ({ product_id, quantity: Number(quantity) })) } : {}),
      }, { withCredentials: true });
      setDone(true); setMessage("Unused ingredients have been restored to their original stock location.");
    } catch (error) { setMessage(getApiErrorMessage(error, "Stock could not be restored.")); }
    finally { setBusy(false); }
  };
  return <section className="cf-card cf-card--padded">
    <h3>Restore unused ingredients</h3>
    <p>Use this only when preparation never consumed the ingredients. Prepared or spoiled food must remain deducted.</p>
    {message && <p role="status">{message}</p>}
    {!done && <form onSubmit={submit}>
      {fullyReturned && <label><input type="checkbox" disabled={submitted} checked={partial} onChange={(event) => setPartial(event.target.checked)} />Restore selected quantities only</label>}
      {useSelection && <><p>Only unused portions with recorded recipe details can be restored. Refund payments remain separate.</p>{products.map(([id, item]) => <label key={id} style={{ display: "block" }}>{item.name}
        <input className="cf-input" type="number" min="0" step="any" disabled={submitted} value={quantities[id] || ""} onChange={(event) => setQuantities({ ...quantities, [id]: event.target.value })} />
      </label>)}</>}
      <label>Reason<input className="cf-input" required maxLength={500} disabled={submitted} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label style={{ display: "flex", gap: 8, padding: "12px 0", minHeight: 44 }}><input type="checkbox" checked={unprepared} onChange={(event) => setUnprepared(event.target.checked)} />I confirm these ingredients were unused and can be returned to stock.</label>
      <button className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} disabled={busy || !unprepared || !reason.trim() || (useSelection && !Object.values(quantities).some((quantity) => Number(quantity) > 0))}>Restore stock</button>
    </form>}
  </section>;
}
