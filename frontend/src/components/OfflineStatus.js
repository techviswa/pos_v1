import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { getOfflineQueue, replayOfflineQueue } from "../core/offline/offlineQueue";

export const OfflineStatus = () => {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [queueCount, setQueueCount] = useState(() => getOfflineQueue().length);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setOnline(navigator.onLine);
      setQueueCount(getOfflineQueue().length);
    };

    const handleOnline = async () => {
      refresh();
      if (!getOfflineQueue().length) return;
      setSyncing(true);
      const result = await replayOfflineQueue();
      setSyncing(false);
      refresh();
      if (result.replayed) {
        toast.success("Offline changes synced", {
          description: `${result.replayed} queued event${result.replayed !== 1 ? "s" : ""} sent to the backend.`,
        });
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", refresh);
    window.addEventListener("cashflow-offline-queue-updated", refresh);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("cashflow-offline-queue-updated", refresh);
    };
  }, []);

  if (online && !queueCount && !syncing) {
    return null;
  }

  return (
    <div className={`cf-offline-status ${online ? "is-online" : "is-offline"}`}>
      <strong>{online ? "Syncing" : "Offline mode"}</strong>
      <span>
        {syncing
          ? "Sending queued changes..."
          : queueCount
            ? `${queueCount} change${queueCount !== 1 ? "s" : ""} queued`
            : "Backend actions will resume when network returns"}
      </span>
    </div>
  );
};
