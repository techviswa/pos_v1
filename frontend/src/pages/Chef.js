import React, { useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { toast } from "sonner";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";

const API_URL = process.env.REACT_APP_BACKEND_URL;
const toArrayPayload = (payload) => {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};
const statusBadgeClass = (status = "pending") => {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized === "ready") return "cf-badge cf-badge--green";
  if (normalized === "preparing") return "cf-badge cf-badge--amber";
  if (normalized === "served") return "cf-badge cf-badge--blue";
  return "cf-badge cf-badge--gray";
};

export const Chef = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const fetchTickets = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/kot`, {
        withCredentials: true,
        params: { limit: 50 },
      });
      setTickets(toArrayPayload(response.data));
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchTickets);

  const kitchenTickets = useMemo(
    () => tickets.filter((ticket) => (ticket.kitchen_status || "pending") !== "served"),
    [tickets]
  );
  const pendingTickets = useMemo(
    () => kitchenTickets.filter((ticket) => (ticket.kitchen_status || "pending") === "pending"),
    [kitchenTickets]
  );
  const preparingTickets = useMemo(
    () => kitchenTickets.filter((ticket) => (ticket.kitchen_status || "pending") === "preparing"),
    [kitchenTickets]
  );
  const readyTickets = useMemo(
    () => kitchenTickets.filter((ticket) => (ticket.kitchen_status || "pending") === "ready"),
    [kitchenTickets]
  );

  const updateStatus = async (ticketId, kitchenStatus) => {
    try {
      await axios.put(`${API_URL}/api/kot/${ticketId}/status`, { kitchen_status: kitchenStatus }, { withCredentials: true });
      toast.success(`Kitchen ticket marked as ${kitchenStatus}`);
      fetchTickets();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to update kitchen status"));
    }
  };

  const renderQueue = (title, items, actionLabel, nextStatus) => (
    <div className="cf-card cf-card--padded">
      <div className="cf-card__title">
        <span>{title}</span>
        <span className="cf-card__meta">{items.length} orders</span>
      </div>
      <div className="cf-kitchen-list">
        {items.length ? (
          items.map((ticket) => (
            <div className="cf-kitchen-list__item" key={ticket.id}>
              <div>
                <div className="cf-kitchen-list__title">{ticket.table_label || ticket.order_type || "Order"} | {ticket.customer_name || ticket.id.slice(0, 8)}</div>
                <div className="cf-kitchen-list__meta">{(ticket.items || []).map((item) => `${item.name} x${item.quantity}`).join(", ")}</div>
                {ticket.notes ? <div className="cf-kitchen-list__meta">Notes: {ticket.notes}</div> : null}
              </div>
              <div className="cf-kitchen-list__stats">
                <span className={statusBadgeClass(ticket.kitchen_status)}>{ticket.kitchen_status || "pending"}</span>
                {nextStatus ? (
                  <button className="cf-btn cf-btn--primary cf-btn--small" onClick={() => updateStatus(ticket.id, nextStatus)} type="button">
                    {actionLabel}
                  </button>
                ) : (
                  <span className="cf-card__meta">Waiting for pickup</span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="cf-empty-state">No orders in this queue.</div>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <Layout title="Chef Screen">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading chef screen...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout title="Chef Screen">
        <div className="cf-page">
          <ApiErrorPanel error={loadError} onRetry={fetchTickets} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Chef Screen">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Chef Kitchen Screen</h1>
            <p>Track prep queues, see order notes clearly, and move each kitchen ticket from pending to ready for service.</p>
          </div>
          <button className="cf-btn cf-btn--secondary" onClick={fetchTickets} type="button">Refresh</button>
        </div>

        <div className="cf-metrics">
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/chef/pending")} type="button">
            <div className="cf-metric__label">Pending</div>
            <div className="cf-metric__value">{pendingTickets.length}</div>
            <div className="cf-metric__sub">Orders waiting to start</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/chef/preparing")} type="button">
            <div className="cf-metric__label">Preparing</div>
            <div className="cf-metric__value">{preparingTickets.length}</div>
            <div className="cf-metric__sub">Currently in the kitchen</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/chef/ready")} type="button">
            <div className="cf-metric__label">Ready</div>
            <div className="cf-metric__value">{readyTickets.length}</div>
            <div className="cf-metric__sub">Ready for waiter pickup</div>
          </button>
        </div>

        <div className="cf-dashboard-grid">
          {renderQueue("Pending Queue", pendingTickets, "Start Prep", "preparing")}
          {renderQueue("Preparing Queue", preparingTickets, "Mark Ready", "ready")}
        </div>

        <div style={{ marginTop: 24 }}>
          {renderQueue("Ready Queue", readyTickets, null, null)}
        </div>
      </div>
    </Layout>
  );
};
