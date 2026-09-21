import React, { useState } from "react";
import axios from "axios";
import { getApiErrorMessage } from "../../../lib/apiErrors";

export function StockReversal({ bill, apiUrl }) {
  const [reason, setReason] = useState("");
  const [unprepared, setUnprepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  if (!["void", "refunded"].includes(bill.status)) return null;
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await axios.post(`${apiUrl}/api/billing/${bill.id}/stock-reversal`, { reason, unprepared }, { withCredentials: true });
      setDone(true); setMessage("Unused ingredients have been restored to their original stock location.");
    } catch (error) { setMessage(getApiErrorMessage(error, "Stock could not be restored.")); }
    finally { setBusy(false); }
  };
  return <section className="cf-card cf-card--padded">
    <h3>Restore unused ingredients</h3>
    <p>Use this only when preparation never consumed the ingredients. Prepared or spoiled food must remain deducted.</p>
    {message && <p role="status">{message}</p>}
    {!done && <form onSubmit={submit}>
      <label>Reason<input className="cf-input" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label style={{ display: "flex", gap: 8, padding: "12px 0", minHeight: 44 }}><input type="checkbox" checked={unprepared} onChange={(event) => setUnprepared(event.target.checked)} />I confirm these ingredients were unused and can be returned to stock.</label>
      <button className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} disabled={busy || !unprepared || !reason.trim()}>Restore stock</button>
    </form>}
  </section>;
}
