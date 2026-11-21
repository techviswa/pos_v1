import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { ApiErrorPanel } from "./ApiErrorPanel";
import { getApiErrorMessage } from "../lib/apiErrors";
import { apiData } from "../lib/apiData";
export const TableAssistanceInbox = () => {
  const { user } = useAuth(), { selectedOutletId } = useActiveOutlet();
  const [items, setItems] = useState([]), [staff, setStaff] = useState([]), [history, setHistory] = useState(false);
  const [error, setError] = useState(null), [busy, setBusy] = useState({}), [sound, setSound] = useState(false);
  const soundContext = useRef(null), seen = useRef(null);
  const scopeKey = `${selectedOutletId}:${history}`;
  const currentScope = useRef(scopeKey), mounted = useRef(true);
  currentScope.current = scopeKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const manager = ["Owner", "Manager"].includes(user?.role);
  const play = () => {
    const context = soundContext.current;
    if (!context || context.state !== "running") return;
    const oscillator = context.createOscillator(), gain = context.createGain();
    gain.gain.value = 0.06; oscillator.frequency.value = 660;
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.18);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  };
  useEffect(() => () => { soundContext.current?.close().catch(() => {}); }, []);
  const load = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/public/qr/assistance/inbox`, { withCredentials: true, skipCache: true, params: { history, ...(selectedOutletId ? { outlet_id: selectedOutletId } : {}) } });
      if (!mounted.current || currentScope.current !== scopeKey) return;
      const data = apiData(response);
      if (!Array.isArray(data?.items) || !Array.isArray(data?.staff)) throw new Error("Invalid table assistance response");
      if (seen.current && data.items.some((row) => row.status === "pending" && !seen.current.has(row.id))) { toast.info("New table assistance request"); if (sound) play(); }
      seen.current = new Set(data.items.map((row) => row.id)); setItems(data.items); setStaff(data.staff); setError(null);
    } catch (failure) { if (mounted.current && currentScope.current === scopeKey) setError(failure); }
  };
  useEffect(() => { seen.current = null; setItems([]); }, [selectedOutletId, history]);
  useAutoRefresh(load, { refreshKey: `${selectedOutletId}:${history}`, liveResources: ["table_assistance", "tables"], intervalMs: 10000, focusThrottleMs: 5000, refreshOnFocus: true, refreshOnVisibility: true });
  const update = async (row, action, assigneeId) => {
    setBusy((current) => ({ ...current, [row.id]: true }));
    try { await axios.post(`${API_URL}/api/public/qr/assistance/${row.id}/${action}`, { ...(assigneeId ? { assignee_id: assigneeId } : {}) }, { withCredentials: true }); await load(); }
    catch (failure) { toast.error(getApiErrorMessage(failure, "Unable to update this request")); }
    finally { setBusy((current) => ({ ...current, [row.id]: false })); }
  };
  return <section className="cf-card cf-card--padded" aria-label="Table service requests" style={{ marginBottom: 16 }}>
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
      <div><h2>Table service requests</h2><p>Accept requests so guests know someone is coming. Unanswered requests are highlighted after two minutes; accepted requests after five minutes.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setHistory(!history)}>{history ? "Show active requests" : "Request history"}</button>
        <button type="button" className="cf-btn cf-btn--secondary" onClick={async () => {
          if (sound) { setSound(false); return; }
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) { toast.error("Sound is not supported in this browser"); return; }
          try { soundContext.current ||= new Audio(); await soundContext.current.resume(); setSound(true); play(); } catch { toast.error("Unable to enable sound"); }
        }}>{sound ? "Mute sound" : "Enable sound"}</button>
        <button type="button" className="cf-btn cf-btn--secondary" onClick={load}>Refresh requests</button>
      </div>
    </div>
    {error ? <ApiErrorPanel error={error} onRetry={load} /> : !items.length ? <p>No {history ? "previous" : "active"} requests.</p> : items.map((row) => <article key={row.id} style={{ borderTop: "1px solid #e2e8f0", padding: "14px 0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><strong>{row.table_name} · {row.label}</strong><span className="cf-badge">{row.status}</span>{row.needs_attention && <span role="status" className="cf-badge cf-badge--amber">Needs manager attention</span>}</div>
      <p>{row.area_name ? `${row.area_name} · ` : ""}{Math.max(0, Math.floor((Date.now() - Date.parse(row.created_at)) / 60000))} min ago{row.assignee_name ? ` · Assigned to ${row.assignee_name}` : " · Unassigned"}</p>
      {row.note && <p>{row.note}</p>}{row.kind === "bill" && <p>Payment preference: {({ cash: "Cash", card: "Card", upi: "UPI", undecided: "Decide at the table" })[row.payment_method]}</p>}
      {["pending", "accepted"].includes(row.status) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {row.status === "pending" && <button type="button" className="cf-btn cf-btn--primary" disabled={busy[row.id]} onClick={() => update(row, "accept")}>Take request</button>}
        {(row.assignee_id === user?.id || manager) && <button type="button" className="cf-btn cf-btn--secondary" disabled={busy[row.id]} onClick={() => update(row, "resolve")}>Mark completed</button>}
        {manager && <select className="cf-input" style={{ width: "auto" }} aria-label={`Assign ${row.label} at ${row.table_name}`} value={row.assignee_id || ""} disabled={busy[row.id]} onChange={(event) => { if (event.target.value) update(row, "assign", event.target.value); }}><option value="">Assign staff…</option>{staff.filter((person) => person.all_outlets || person.outlet_ids?.includes(row.outlet_id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}
      </div>}
      {history && <details><summary>Service history</summary><ul>{row.history.map((entry, index) => <li key={index}>{new Date(entry.at).toLocaleString()} · {entry.action}{entry.actor_name ? ` · ${entry.actor_name}` : ""}{entry.assignee_name ? ` → ${entry.assignee_name}` : ""}</li>)}</ul></details>}
    </article>)}
  </section>;
};
