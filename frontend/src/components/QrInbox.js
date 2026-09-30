import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency } from "../lib/pos";
import { ApiErrorPanel } from "./ApiErrorPanel";

/**
 * Customer QR orders that wait for the restaurant's approval. Approving sends the order to the kitchen (KOT);
 * rejecting tells the customer on their tracking page. Updates live as new QR orders arrive.
 */
export const QrInbox = ({ currency }) => {
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState({});

  const fetchInbox = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/public/qr/inbox`, { withCredentials: true, skipCache: true });
      const payload = response.data?.data ?? response.data;
      setOrders(Array.isArray(payload?.items) ? payload.items : []);
      setError(null);
    } catch (requestError) {
      // Roles without QR approval rights simply do not see the inbox.
      if ([403, 404].includes(requestError?.response?.status)) setHidden(true);
      else setError(requestError);
    }
  };

  useAutoRefresh(fetchInbox, { liveResources: ["qr_orders"], refreshOnFocus: true, enabled: !hidden });

  const act = async (order, action) => {
    let reason = "";
    if (action === "reject") {
      reason = window.prompt(`Reject the order from ${order.customerName || "this table"}? Give the customer a reason:`) || "";
      if (!reason.trim()) return;
    }
    setBusy((current) => ({ ...current, [order.id]: true }));
    try {
      await axios.post(`${API_URL}/api/public/qr/orders/${order.id}/${action}`, action === "reject" ? { reason } : {}, { withCredentials: true });
      toast.success(action === "approve" ? "Order approved and sent to the kitchen" : "Order rejected");
      await fetchInbox();
    } catch (requestError) {
      toast.error(getApiErrorMessage(requestError, "Could not update this QR order"));
      await fetchInbox();
    } finally {
      setBusy((current) => ({ ...current, [order.id]: false }));
    }
  };

  if (hidden) return null;

  return (
    <section className="cf-card cf-card--padded" aria-label="QR orders waiting for approval">
      <h2>QR orders waiting for approval {orders.length ? `(${orders.length})` : ""}</h2>
      {error ? <ApiErrorPanel error={error} onRetry={fetchInbox} /> : orders.length ? orders.map((order) => (
        <div key={order.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid var(--cf-border, #eee)" }}>
          <div style={{ flex: "1 1 240px" }}>
            <strong>{order.metadata?.table_name || "Table"} · {order.customerName || "Guest"}</strong>
            <p>{(order.items || []).map((item) => `${item.name} ×${item.quantity}`).join(", ")}</p>
            <p className="cf-card__meta">
              {formatCurrency(order.total, currency)}
              {order.metadata?.notes ? ` · Note: ${order.metadata.notes}` : ""}
              {order.created_at ? ` · ${new Date(order.created_at).toLocaleTimeString()}` : ""}
            </p>
          </div>
          <button type="button" className="cf-btn cf-btn--primary" style={{ minHeight: 44 }} disabled={busy[order.id]} onClick={() => act(order, "approve")}>Approve</button>
          <button type="button" className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} disabled={busy[order.id]} onClick={() => act(order, "reject")}>Reject</button>
        </div>
      )) : <p>No QR orders waiting.</p>}
    </section>
  );
};
