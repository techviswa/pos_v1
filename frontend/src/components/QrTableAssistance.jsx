import React, { useEffect, useState } from "react";
import axios from "axios";
import { resolveQrApiBaseUrl } from "../lib/qrUrls";
import { getApiErrorMessage } from "../lib/apiErrors";
import { apiData } from "../lib/apiData";
const API_URL = resolveQrApiBaseUrl(process.env.REACT_APP_BACKEND_URL);
const STATUS = { pending: "Request sent — waiting for the team", accepted: "Someone is coming", resolved: "Completed" };
const OPTIONS = { water: "Drinking water", cutlery: "Cutlery", tissues: "Tissues", cleaning: "Table cleaning", chair: "Extra chair", other: "Other assistance" };
export const QrTableAssistance = ({ token, sessionKey }) => {
  const [requests, setRequests] = useState([]), [form, setForm] = useState(null), [kind, setKind] = useState("water");
  const [note, setNote] = useState(""), [payment, setPayment] = useState("undecided"), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    if (!sessionKey) return undefined;
    let active = true, running = false;
    const load = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const response = await axios.get(`${API_URL}/api/public/qr/${token}/assistance`, { params: { session_key: sessionKey }, skipCache: true });
        const data = apiData(response);
        if (!Array.isArray(data)) throw new Error("Invalid table assistance response");
        if (active) { setRequests(data); setError(""); }
      } catch (failure) { if (active) setError(getApiErrorMessage(failure, "Unable to check table requests. Try again shortly.")); }
      finally { running = false; }
    };
    setRequests([]); setNotice(""); setError(""); load();
    const timer = window.setInterval(load, 5000);
    window.addEventListener("focus", load); document.addEventListener("visibilitychange", load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", load); };
  }, [token, sessionKey]);
  const send = async (requestKind) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await axios.post(`${API_URL}/api/public/qr/${token}/assistance`, { session_key: sessionKey, kind: requestKind, note: requestKind === "waiter" ? "" : note, ...(requestKind === "bill" ? { payment_method: payment } : {}) });
      const data = apiData(response);
      if (!data?.request?.id) throw new Error("Invalid table assistance acknowledgement");
      setRequests((current) => [data.request, ...current.filter((row) => row.id !== data.request.id)]);
      setNotice(data.duplicate ? "Your request is already with the team." : "Your table request has been sent.");
      setForm(null); setNote("");
    } catch (failure) { setError(getApiErrorMessage(failure, "Unable to send your request. Please try again.")); }
    finally { setBusy(false); }
  };
  if (!sessionKey) return null;
  const openWaiter = requests.some((row) => row.kind === "waiter" && row.status !== "resolved");
  return <section className="cf-card cf-card--padded" aria-label="Table assistance" style={{ margin: "16px 0" }}>
    <h2 style={{ marginTop: 0 }}>Need a hand?</h2><p>Send a request to the team for this table.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="cf-btn cf-btn--primary" style={{ minHeight: 44 }} disabled={busy || openWaiter} onClick={() => send("waiter")}>{openWaiter ? "Waiter requested" : "Call waiter"}</button>
      <button type="button" className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} disabled={busy} onClick={() => setForm(form === "assistance" ? null : "assistance")}>Table assistance</button>
      <button type="button" className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} disabled={busy} onClick={() => setForm(form === "bill" ? null : "bill")}>Request bill</button>
    </div>
    {form && <form onSubmit={(event) => { event.preventDefault(); send(form === "bill" ? "bill" : kind); }} style={{ display: "grid", gap: 10, marginTop: 12 }}>
      {form === "bill" ? <label>How would you like to pay?<select className="cf-input" value={payment} onChange={(event) => setPayment(event.target.value)}><option value="undecided">Decide later</option><option value="cash">Cash</option><option value="card">Card</option><option value="upi">UPI</option></select></label>
        : <label>What do you need?<select className="cf-input" value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <label>Note {form !== "bill" && kind === "other" ? "(required)" : "(optional)"}<textarea className="cf-input" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} required={form !== "bill" && kind === "other"} placeholder="For example: two glasses of water" /></label>
      {form === "bill" && <small>This asks the team to bring your bill. It does not charge you.</small>}
      <div style={{ display: "flex", gap: 8 }}><button className="cf-btn cf-btn--primary" disabled={busy} type="submit">{busy ? "Sending…" : "Send request"}</button><button className="cf-btn cf-btn--secondary" type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button></div>
    </form>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="cf-qr-error">{error}</p>}
    <div aria-live="polite">{requests.slice(0, 8).map((row) => <div key={row.id} style={{ padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}><strong>{row.label}</strong><div>{STATUS[row.status] || row.status}</div></div>)}</div>
  </section>;
};
