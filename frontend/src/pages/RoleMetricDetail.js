import React, { useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { formatCurrency } from "../lib/pos";
import { useUi } from "../contexts/UiContext";
import { useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";

const API_URL = process.env.REACT_APP_BACKEND_URL;
const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "occupied"]);
const waiterOwnershipLabel = (bill, user) => {
  if (bill.created_by === user?.id) {
    return "Your order";
  }
  return bill.created_by_name ? `Other waiter: ${bill.created_by_name}` : "Other waiter";
};

const enrichReservations = (reservations = [], tables = []) => {
  const tableMap = new Map((tables || []).map((table) => [table.id, table]));
  return reservations.map((reservation) => {
    const table = tableMap.get(reservation.table_id);
    return {
      ...reservation,
      table_label: reservation.table_label || table?.name || "Table",
      area_name: reservation.area_name || table?.area_name || null,
      table_code: table?.code || null,
      table_category: table?.meta?.category || table?.meta?.category_label || null,
      table_billing_status: table?.billing_status || null,
      reservation_history_count: Array.isArray(table?.meta?.reservation_history) ? table.meta.reservation_history.length : 0,
    };
  });
};

const PAGE_META = {
  waiter: {
    reservations: {
      title: "Reserved Tables",
      description: "All table reservations with guest details and notes.",
    },
    active: {
      title: "Active Dine-In Orders",
      description: "Orders still being prepared or served for dine-in guests.",
    },
    ready: {
      title: "Orders Ready",
      description: "Orders ready for waiter pickup and guest delivery.",
    },
  },
  chef: {
    pending: {
      title: "Pending Queue",
      description: "Orders waiting to be started in the kitchen.",
    },
    preparing: {
      title: "Preparing Queue",
      description: "Orders currently being prepared by the kitchen.",
    },
    ready: {
      title: "Ready Queue",
      description: "Orders completed and waiting for service pickup.",
    },
  },
  manager: {
    sales: {
      title: "Sales Today",
      description: "Bills recorded today for manager oversight.",
    },
    rating: {
      title: "Customer Rating",
      description: "Customer feedback and comments collected from guests.",
    },
    inventory: {
      title: "Inventory Risks",
      description: "Items requiring manager attention due to stock or expiry pressure.",
    },
    online: {
      title: "Online Orders",
      description: "All online and delivery-linked orders.",
    },
    swaps: {
      title: "Shift Swap Requests",
      description: "Waiter shift swap approvals and request history.",
    },
  },
};

export const RoleMetricDetail = () => {
  const { role, metric } = useParams();
  const navigate = useNavigate();
  const { settings } = useUi();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [feedback, setFeedback] = useState({ items: [], summary: {} });
  const [inventory, setInventory] = useState({ items: [], at_risk_items: [] });
  const [swapRequests, setSwapRequests] = useState([]);

  const fetchData = async () => {
    try {
      const [billsRes, tableManagementRes, feedbackRes, inventoryRes, swapRes] = await Promise.all([
        axios.get(`${API_URL}/api/bills`, { withCredentials: true }).catch(() => ({ data: [] })),
        fulfillmentService.fetchTableManagement({ force: true, includeHistory: true }).catch(() => ({
          tables: { items: [] },
          reservations: { items: [] },
        })),
        axios.get(`${API_URL}/api/feedback`, { withCredentials: true }).catch(() => ({ data: { items: [], summary: {} } })),
        axios.get(`${API_URL}/api/inventory`, { withCredentials: true }).catch(() => ({ data: { items: [], at_risk_items: [] } })),
        axios.get(`${API_URL}/api/shift-swaps`, { withCredentials: true }).catch(() => ({ data: [] })),
      ]);
      setBills(billsRes.data || []);
      setReservations(
        enrichReservations(tableManagementRes?.reservations?.items || [], tableManagementRes?.tables?.items || []),
      );
      setFeedback(feedbackRes.data || { items: [], summary: {} });
      setInventory(inventoryRes.data || { items: [], at_risk_items: [] });
      setSwapRequests(swapRes.data || []);
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchData);

  const dineInBills = useMemo(
    () => bills.filter((bill) => (bill.order_type || "Dine-In") === "Dine-In"),
    [bills]
  );
  const normalizedRole = role || "manager";
  const normalizedMetric = metric || "";
  const roleConfig = PAGE_META[normalizedRole] || null;
  const meta = roleConfig?.[normalizedMetric] || { title: "Details", description: "Detail view" };
  const backPath = roleConfig ? `/${normalizedRole}` : "/dashboard";
  const backLabel = roleConfig
    ? normalizedRole.charAt(0).toUpperCase() + normalizedRole.slice(1)
    : "Dashboard";

  if (loading) {
    return (
      <Layout title={meta.title}>
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading details...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const renderWaiter = () => {
    if (normalizedMetric === "reservations") {
      const activeReservations = reservations.filter((reservation) =>
        ACTIVE_RESERVATION_STATUSES.has(String(reservation.status || "").toLowerCase()),
      );
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Reservation Details</div>
          <table className="cf-table">
            <thead><tr><th>Table</th><th>Area / Category</th><th>Customer</th><th>Status</th><th>Schedule</th><th>Notes</th><th>History</th></tr></thead>
            <tbody>
              {activeReservations.length ? activeReservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td>{reservation.table_label}{reservation.table_code ? ` | ${reservation.table_code}` : ""}</td>
                  <td>{[reservation.area_name, reservation.table_category].filter(Boolean).join(" / ") || "-"}</td>
                  <td>{reservation.customer_name || "Walk-in"}</td>
                  <td style={{ textTransform: "capitalize" }}>
                    {ACTIVE_RESERVATION_STATUSES.has(String(reservation.status || "").toLowerCase()) ? reservation.status : "history"}
                  </td>
                  <td>{reservation.reservation_for ? new Date(reservation.reservation_for).toLocaleString("en-IN") : "-"}</td>
                  <td>{reservation.notes || reservation.source || "-"}</td>
                  <td>{reservation.reservation_history_count || "-"}</td>
                </tr>
              )) : <tr><td colSpan="7" style={{ color: "var(--cf-text-3)" }}>No active reserved tables found.</td></tr>}
            </tbody>
          </table>
        </div>
      );
    }
    const source = normalizedMetric === "ready"
      ? dineInBills.filter((bill) => (bill.kitchen_status || "pending") === "ready")
      : dineInBills.filter((bill) => bill.created_by === user?.id && (bill.kitchen_status || "pending") !== "served");
    return (
      <div className="cf-table-wrap">
        <div className="cf-section-title">{normalizedMetric === "ready" ? "Ready Orders" : "Active Dine-In Orders"}</div>
        <table className="cf-table">
          <thead><tr><th>Table</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Owner</th></tr></thead>
          <tbody>
            {source.length ? source.map((bill) => (
              <tr key={bill.id}>
                <td>{bill.table_label || "-"}</td>
                <td>{bill.customer_name || "Walk-in"}</td>
                <td>{(bill.items || []).map((item) => `${item.name} x${item.quantity}`).join(", ")}</td>
                <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                <td style={{ textTransform: "capitalize" }}>{bill.kitchen_status || "pending"}</td>
                <td>{waiterOwnershipLabel(bill, user)}</td>
              </tr>
            )) : <tr><td colSpan="6" style={{ color: "var(--cf-text-3)" }}>No matching orders found.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  const renderChef = () => {
    const source = bills.filter((bill) => {
      const status = bill.kitchen_status || "pending";
      return normalizedMetric === "pending" ? status === "pending" : normalizedMetric === "preparing" ? status === "preparing" : status === "ready";
    });
    return (
      <div className="cf-table-wrap">
        <div className="cf-section-title">{meta.title}</div>
        <table className="cf-table">
          <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Notes</th><th>Status</th></tr></thead>
          <tbody>
            {source.length ? source.map((bill) => (
              <tr key={bill.id}>
                <td>{bill.table_label || bill.order_type || "Order"}</td>
                <td>{bill.customer_name || bill.id.slice(0, 8)}</td>
                <td>{(bill.items || []).map((item) => `${item.name} x${item.quantity}`).join(", ")}</td>
                <td>{bill.notes || "-"}</td>
                <td style={{ textTransform: "capitalize" }}>{bill.kitchen_status || "pending"}</td>
              </tr>
            )) : <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No orders in this queue.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  const renderManager = () => {
    if (normalizedMetric === "rating") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Customer Feedback</div>
          <table className="cf-table">
            <thead><tr><th>Bill</th><th>Rating</th><th>Comment</th><th>Submitted</th></tr></thead>
            <tbody>
              {(feedback.items || []).length ? feedback.items.map((item) => (
                <tr key={item.id}>
                  <td className="cf-table__mono">{item.bill_id}</td>
                  <td className="cf-table__mono">{item.rating}/5</td>
                  <td>{item.comment || "-"}</td>
                  <td>{new Date(item.created_at).toLocaleString("en-IN")}</td>
                </tr>
              )) : <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No feedback collected yet.</td></tr>}
            </tbody>
          </table>
        </div>
      );
    }
    if (normalizedMetric === "inventory") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Inventory Risk Details</div>
          <table className="cf-table">
            <thead><tr><th>Item</th><th>Stock</th><th>Days Left</th><th>Expiry</th></tr></thead>
            <tbody>
              {(inventory.at_risk_items || []).length ? inventory.at_risk_items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                  <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                  <td className="cf-table__mono">{item.expiry_date ? item.expiry_date.slice(0, 10) : "-"}</td>
                </tr>
              )) : <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No inventory risks found.</td></tr>}
            </tbody>
          </table>
        </div>
      );
    }
    if (normalizedMetric === "swaps") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Shift Swap Requests</div>
          <table className="cf-table">
            <thead><tr><th>Requester</th><th>Swap With</th><th>Date</th><th>Reason</th><th>Status</th></tr></thead>
            <tbody>
              {swapRequests.length ? swapRequests.map((request) => (
                <tr key={request.id}>
                  <td>{request.requester_name || "-"}</td>
                  <td>{request.target_staff_name || "-"}</td>
                  <td>{request.requested_for ? new Date(request.requested_for).toLocaleDateString("en-IN") : "-"}</td>
                  <td>{request.note || "-"}</td>
                  <td style={{ textTransform: "capitalize" }}>{request.status || "pending"}</td>
                </tr>
              )) : <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No shift swap requests found.</td></tr>}
            </tbody>
          </table>
        </div>
      );
    }
    const source = normalizedMetric === "online"
      ? bills.filter((bill) => (bill.payment_type || "").toLowerCase().match(/online|website|web|delivery|swiggy|zomato/))
      : bills.filter((bill) => new Date(bill.created_at) >= new Date(new Date().setHours(0, 0, 0, 0)));
    return (
      <div className="cf-table-wrap">
        <div className="cf-section-title">{normalizedMetric === "online" ? "Online Orders" : "Today Sales"}</div>
        <table className="cf-table">
          <thead><tr><th>Bill</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Time</th></tr></thead>
          <tbody>
            {source.length ? source.map((bill) => (
              <tr key={bill.id}>
                <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                <td>{bill.customer_name || "Walk-in"}</td>
                <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                <td>{bill.payment_type}</td>
                <td>{new Date(bill.created_at).toLocaleString("en-IN")}</td>
              </tr>
            )) : <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No matching data found.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Layout title={meta.title}>
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.description}</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" onClick={() => navigate(backPath)} type="button">
              Back to {backLabel}
            </button>
          </div>
        </div>
        {normalizedRole === "waiter" ? renderWaiter() : normalizedRole === "chef" ? renderChef() : renderManager()}
      </div>
    </Layout>
  );
};
