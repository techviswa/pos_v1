import React, { useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { toast } from "sonner";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";

const API_URL = (() => {
  const configured = String(process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
  if (typeof window === "undefined") return configured;

  const currentOrigin = window.location.origin.replace(/\/+$/, "");
  const currentHost = window.location.hostname;
  if (configured && configured !== currentOrigin && !configured.includes("vercel.app")) {
    return configured;
  }

  if (currentHost === "localhost" || currentHost === "127.0.0.1") {
    return configured || "http://localhost:4001";
  }

  return "https://pos-v1-fwjm.onrender.com";
})();
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
  const [station, setStation] = useState("");
  const [stations, setStations] = useState([]);
  const [busy, setBusy] = useState({});
  const [historyTicket, setHistoryTicket] = useState(null);
  const [rejection, setRejection] = useState({ ticketId: null, reason: "" });

  const fetchTickets = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/kot`, {
        withCredentials: true,
        params: { limit: 50 },
      });
      setTickets(toArrayPayload(response.data));
      setStations(response.data?.data?.stations || []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchTickets);

  const kitchenTickets = useMemo(
    () => tickets.filter((ticket) => !["served", "completed", "rejected"].includes(ticket.kitchen_status || ticket.status)
      && (!station || (ticket.items || []).some((item) => item.station_id === station))),
    [tickets, station]
  );
  const pendingTickets = useMemo(
    () => kitchenTickets.filter((ticket) => (ticket.kitchen_status || "pending") === "pending"),
    [kitchenTickets]
  );
  const preparingTickets = useMemo(
    () => kitchenTickets.filter((ticket) => (ticket.kitchen_status || "pending") === "preparing"),
    [kitchenTickets]
  );
  const acceptedTickets = kitchenTickets.filter((ticket) => (ticket.kitchen_status || ticket.status) === "accepted");
  const readyTickets = useMemo(
    () => kitchenTickets.filter((ticket) => (ticket.kitchen_status || "pending") === "ready"),
    [kitchenTickets]
  );

  const updateStatus = async (ticketId, kitchenStatus) => {
    setBusy((current) => ({ ...current, [ticketId]: true }));
    try {
      await axios.put(`${API_URL}/api/kot/${ticketId}/status`, { kitchen_status: kitchenStatus }, { withCredentials: true });
      toast.success(`Kitchen ticket marked as ${kitchenStatus}`);
      await fetchTickets();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to update kitchen status"));
    } finally {
      setBusy((current) => ({ ...current, [ticketId]: false }));
    }
  };

  const updateItem = async (ticket, item, status) => {
    setBusy((current) => ({ ...current, [ticket.id]: true }));
    try {
      await axios.put(`${API_URL}/api/kot/${ticket.id}/items/${item.item_id}/status`, { status }, { withCredentials: true });
      await fetchTickets();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to update this kitchen item"));
    } finally {
      setBusy((current) => ({ ...current, [ticket.id]: false }));
    }
  };

  const viewHistory = async (ticket) => {
    try {
      const response = await axios.get(`${API_URL}/api/kot/${ticket.id}/history`, { withCredentials: true });
      setHistoryTicket({ title: ticket.ticket_number, audit: response.data?.data?.audit || [] });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to load ticket history"));
    }
  };
  const rejectTicket = async () => {
    const ticketId = rejection.ticketId;
    setBusy((current) => ({ ...current, [ticketId]: true }));
    try {
      await axios.post(`${API_URL}/api/kot/${ticketId}/reject`, { reason: rejection.reason.trim() }, { withCredentials: true });
      setRejection({ ticketId: null, reason: "" });
      await fetchTickets();
    } catch (error) { toast.error(getApiErrorMessage(error, "Unable to reject this order")); }
    finally { setBusy((current) => ({ ...current, [ticketId]: false })); }
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
                <div className="cf-kitchen-list__meta">{ticket.ticket_number} · {ticket.elapsed_prep_minutes || 0} min / {ticket.estimated_prep_minutes || 20} min target</div>
                {ticket.sla_status === "breached" && <strong role="status" className="cf-badge cf-badge--amber">Preparation overdue</strong>}
                {(ticket.items || []).filter((item) => !station || item.station_id === station).map((item) => {
                  const next = { pending: "accepted", accepted: "preparing", preparing: "ready" }[item.status];
                  return <div key={item.item_id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 0" }}>
                    <span>{item.name} ×{item.quantity} · {item.station_name} · {item.status}</span>
                    {next && <button type="button" className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} disabled={busy[ticket.id]}
                      onClick={() => updateItem(ticket, item, next)}>{({ accepted: "Accept item", preparing: "Prepare item", ready: "Item ready" })[next]}</button>}
                  </div>;
                })}
                {ticket.notes ? <div className="cf-kitchen-list__meta">Notes: {ticket.notes}</div> : null}
              </div>
              <div className="cf-kitchen-list__stats">
                <span className={statusBadgeClass(ticket.kitchen_status)}>{ticket.kitchen_status || "pending"}</span>
                {nextStatus ? (
                  <button className="cf-btn cf-btn--primary" style={{ minHeight: 44 }} disabled={busy[ticket.id] || Boolean(station)} onClick={() => updateStatus(ticket.id, nextStatus)} type="button">
                    {actionLabel}
                  </button>
                ) : (
                  <span className="cf-card__meta">Waiting for pickup</span>
                )}
                <button className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} onClick={() => viewHistory(ticket)} type="button">History</button>
                {["pending", "accepted", "preparing"].includes(ticket.status) && !station && <button className="cf-btn cf-btn--secondary" style={{ minHeight: 44 }} disabled={busy[ticket.id]} onClick={() => setRejection({ ticketId: ticket.id, reason: "" })} type="button">Reject order</button>}
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
          <label>Kitchen station
            <select className="cf-input" style={{ minHeight: 44 }} value={station} onChange={(event) => setStation(event.target.value)}>
              <option value="">All stations</option>
              {stations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          {station && <p>Showing items for this station. Use item actions to update them.</p>}
        </div>
        {rejection.ticketId && <section className="cf-card cf-card--padded" aria-label="Reject kitchen order">
          <h2>Reject kitchen order</h2>
          <label>Reason<textarea className="cf-input" value={rejection.reason} onChange={(event) => setRejection({ ...rejection, reason: event.target.value })} /></label>
          <button type="button" className="cf-btn cf-btn--primary" disabled={!rejection.reason.trim() || busy[rejection.ticketId]} onClick={rejectTicket}>Confirm rejection</button>
          <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setRejection({ ticketId: null, reason: "" })}>Cancel</button>
        </section>}
        {historyTicket && <section className="cf-card cf-card--padded" aria-label="Kitchen ticket history">
          <h2>{historyTicket.title} history</h2>
          <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setHistoryTicket(null)}>Close history</button>
          <ol>{historyTicket.audit.map((event) => <li key={event.id}>
            {new Date(event.at).toLocaleString()} · {String(event.action).replace(/_/g, " ")} · {event.actor_name || "System"}{event.reason ? ` · ${event.reason}` : ""}
          </li>)}</ol>
        </section>}
        <div className="cf-dashboard-grid">
          {renderQueue("Pending Queue", pendingTickets, "Accept Order", "accepted")}
          {renderQueue("Accepted Queue", acceptedTickets, "Start Prep", "preparing")}
          {renderQueue("Preparing Queue", preparingTickets, "Mark Ready", "ready")}
        </div>

        <div style={{ marginTop: 24 }}>
          {renderQueue("Ready Queue", readyTickets, null, null)}
        </div>
      </div>
    </Layout>
  );
};

