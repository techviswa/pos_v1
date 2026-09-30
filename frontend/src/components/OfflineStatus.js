import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  discardOfflineBill,
  getOfflineQueue,
  OFFLINE_QUEUE_EVENT,
  replayOfflineQueue,
  retryOfflineBill,
} from "../core/offline/offlineQueue";
import { applyAppUpdate, hasWaitingUpdate, SW_UPDATE_EVENT } from "../serviceWorkerRegistration";

const RETRY_INTERVAL_MS = 30000;

export const OfflineStatus = () => {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [queue, setQueue] = useState(() => getOfflineQueue());
  const [syncing, setSyncing] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const [updateReady, setUpdateReady] = useState(() => hasWaitingUpdate());

  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener(SW_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(SW_UPDATE_EVENT, onUpdate);
  }, []);

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      setQueue(getOfflineQueue());
    };

    const sync = async () => {
      refresh();
      if (!navigator.onLine || !getOfflineQueue().some((row) => row.status === "pending")) return;
      setSyncing(true);
      try {
        const result = await replayOfflineQueue();
        if (result.replayed) {
          toast.success(`${result.replayed} offline bill${result.replayed !== 1 ? "s" : ""} synced`);
        }
        if (result.failed) {
          toast.error(`${result.failed} offline bill${result.failed !== 1 ? "s were" : " was"} refused by the server and need review`);
        }
      } finally {
        setSyncing(false);
        refresh();
      }
    };

    // Retry on reconnect, on load (a reload may happen while bills are queued) and periodically, because the
    // browser's "online" signal does not always mean the server is reachable.
    void sync();
    const timer = window.setInterval(sync, RETRY_INTERVAL_MS);
    window.addEventListener("online", sync);
    window.addEventListener("offline", refresh);
    window.addEventListener(OFFLINE_QUEUE_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", refresh);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, refresh);
    };
  }, []);

  const pending = queue.filter((row) => row.status === "pending");
  const failed = queue.filter((row) => row.status === "failed");

  if (online && !pending.length && !failed.length && !syncing) {
    return updateReady ? (
      <div className="cf-offline-status is-online" role="status">
        <strong>Update ready</strong>
        <span>
          A new version of the POS is available.{" "}
          <button type="button" className="cf-btn cf-btn--secondary" onClick={applyAppUpdate}>Reload now</button>
        </span>
      </div>
    ) : null;
  }

  const retry = async (id) => {
    setSyncing(true);
    try {
      await retryOfflineBill(id);
    } finally {
      setSyncing(false);
      setQueue(getOfflineQueue());
    }
  };

  const discard = (row) => {
    if (!window.confirm(`Discard offline bill ${row.summary?.label || row.id} for ${row.summary?.total ?? ""}? It was never recorded on the server.`)) return;
    discardOfflineBill(row.id);
    setQueue(getOfflineQueue());
  };

  return (
    <div className={`cf-offline-status ${online ? "is-online" : "is-offline"}`} role="status">
      <strong>{!online ? "Offline mode" : syncing ? "Syncing" : failed.length ? "Needs review" : "Waiting to sync"}</strong>
      <span>
        {syncing
          ? "Sending offline bills..."
          : pending.length
            ? `${pending.length} offline bill${pending.length !== 1 ? "s" : ""} not yet on the server`
            : !online
              ? "Cash and due bills can still be taken; they sync when the connection returns"
              : ""}
        {failed.length ? (
          <>
            {" "}
            <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setShowFailed((value) => !value)}>
              {failed.length} refused — {showFailed ? "hide" : "review"}
            </button>
          </>
        ) : null}
      </span>
      {showFailed && failed.length ? (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
          {failed.map((row) => (
            <li key={row.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
              <span>
                {row.summary?.label || row.id} · {row.summary?.total ?? ""} · {new Date(row.payload?.offline_created_at || row.queued_at).toLocaleString()} — {row.last_error}
              </span>
              <button type="button" className="cf-btn cf-btn--secondary" disabled={syncing || !online} onClick={() => retry(row.id)}>Retry</button>
              <button type="button" className="cf-btn cf-btn--secondary" onClick={() => discard(row)}>Discard</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
