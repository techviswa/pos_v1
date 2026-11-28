import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../lib/apiUrl";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");
const size = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : "");

/** "Last backup" row of Settings: the platform's nightly off-site backup as it concerns this business. */
export function BackupStatusRow() {
  const [status, setStatus] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    axios.get(`${API_URL}/api/backups/status`, { withCredentials: true, skipCache: true })
      .then((response) => { if (active) setStatus(apiData(response)); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  let text = "Checking…";
  if (failed) text = "Status could not be loaded";
  else if (status && !status.configured) text = "Not set up yet: off-site storage has not been connected";
  else if (status?.last_success_at) text = `${when(status.last_success_at)} · ${size(status.last_bytes)} · ${status.last_verified ? "verified" : "not verified"}`;
  else if (status) text = "No backup has completed yet";
  return (
    <tr data-testid="backup-status">
      <td style={{ color: "var(--cf-text-2)" }}>Last backup</td>
      <td className="cf-table__mono">
        {text}
        {status?.configured && status.last_failure_at && (!status.last_success_at || status.last_failure_at > status.last_success_at)
          ? <div role="alert" style={{ color: "var(--cf-red)" }}>Latest attempt failed {when(status.last_failure_at)}. It is retried automatically.</div> : null}
        {status?.configured ? <div className="cf-card__meta">Nightly at {String(status.schedule.hour).padStart(2, "0")}:00 ({status.schedule.timezone}); {status.schedule.keep_daily} daily and {status.schedule.keep_monthly} monthly copies kept, encrypted.</div> : null}
      </td>
    </tr>
  );
}

/** Owner-only: everything this business holds as one JSON file. */
export function DownloadBusinessData() {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const response = await axios.get(`${API_URL}/api/backups/my-data`, { withCredentials: true, responseType: "blob", skipCache: true });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `business-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Your business data was downloaded. Keep the file somewhere safe: it contains customer details.");
    } catch (error) { toast.error(getApiErrorMessage(error, "The data could not be downloaded")); }
    finally { setBusy(false); }
  };
  return (
    <div className="cf-field">
      <button className="cf-btn cf-btn--secondary" type="button" disabled={busy} onClick={download} data-testid="download-business-data">{busy ? "Preparing…" : "Download my business data"}</button>
      <span className="cf-card__meta">Bills, orders, products, stock, outlets, staff and tables as one file (your own copy, separate from the nightly backup).</span>
    </div>
  );
}
