import React, { useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { API_URL } from "../lib/apiUrl";
import { apiData } from "../lib/apiData";
import { getApiErrorMessage } from "../lib/apiErrors";

export function AdmincoreSyncHealth() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const canReconcile = ["owner", "manager"].includes(String(user?.role || "").toLowerCase());
  const refresh = async () => {
    const current = ++sequence.current;
    try { const response = await axios.get(`${API_URL}/api/sync/delivery-health`, { withCredentials: true, skipCache: true }); if (current === sequence.current) { setStatus(apiData(response)); setError(""); } }
    catch (failure) { if (current === sequence.current) setError(getApiErrorMessage(failure, "Sync status unavailable")); }
  };
  useAutoRefresh(refresh, { intervalMs: 30000, refreshOnFocus: true });
  const reconcile = async () => {
    setBusy(true);
    try { await axios.post(`${API_URL}/api/sync/reconcile`, {}, { withCredentials: true }); await refresh(); }
    catch (failure) { setError(getApiErrorMessage(failure, "Unable to request reconciliation")); }
    finally { setBusy(false); }
  };
  return <div className="cf-card cf-card--padded" style={{ marginBottom: 20 }} aria-label="AdminCore synchronisation">
    <strong>AdminCore synchronisation</strong>
    {error ? <p role="alert">{error} <button className="cf-btn cf-btn--small" onClick={refresh}>Retry status</button></p> : null}
    {status ? <>
      <p>{!status.configured ? "Connection not configured." : `${status.pending_notifications} notifications pending · ${status.unresolved_failures} unresolved failures`}</p>
      {status.unresolved_failures > 0 ? <p>Affected: {status.resources.join(", ")}. {canReconcile && <button className="cf-btn cf-btn--small" disabled={busy} onClick={reconcile}>Reconcile current data</button>}</p> : null}
      {status.reconciliations?.length ? <p>{status.reconciliations.filter((row) => row.verified).length} of {status.reconciliations.length} reconciliation imports verified.</p> : null}
      <small>Notifications accepted by AdminCore may still be importing. Historical failures are retained for audit.</small>
    </> : !error ? <p>Checking sync status…</p> : null}
  </div>;
}
