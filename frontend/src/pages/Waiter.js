import React, { useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { toast } from "sonner";
import { formatCurrency } from "../lib/pos";
import { getApiErrorMessage } from "../lib/apiErrors";
import { useUi } from "../contexts/UiContext";
import { useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { fulfillmentService } from "../features/billing/fulfillment/services/fulfillment.service";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";

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
const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "occupied"]);
const toArrayPayload = (payload) => {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};
const statusBadgeClass = (status = "pending") => {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized === "ready") return "cf-badge cf-badge--green";
  if (normalized === "served") return "cf-badge cf-badge--blue";
  if (normalized === "preparing") return "cf-badge cf-badge--amber";
  return "cf-badge cf-badge--gray";
};
const waiterOwnershipLabel = (bill, user) => {
  if (bill.created_by === user?.id) {
    return "Your order";
  }
  return bill.created_by_name ? `Other waiter: ${bill.created_by_name}` : "Other waiter";
};

const waiterOwnershipClass = (bill, user) =>
  bill.created_by === user?.id ? "cf-badge cf-badge--blue" : "cf-badge cf-badge--gray";

const enrichReservations = (reservations = [], tables = []) => {
  const tableMap = new Map((tables || []).map((table) => [table.id, table]));
  return reservations.map((reservation) => {
    const table = tableMap.get(reservation.table_id);
    return {
      ...reservation,
      table_label: reservation.table_label || table?.name || "Table",
      area_name: reservation.area_name || table?.area_name || null,
      table_code: table?.code || null,
      table_shape: table?.shape || null,
      table_status: table?.status || null,
      table_billing_status: table?.billing_status || null,
      table_category: table?.meta?.category || table?.meta?.category_label || null,
      reservation_history_count: Array.isArray(table?.meta?.reservation_history) ? table.meta.reservation_history.length : 0,
    };
  });
};

export const Waiter = () => {
  const navigate = useNavigate();
  const { settings } = useUi();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [staff, setStaff] = useState([]);
  const [swapRequests, setSwapRequests] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [showSwapDialog, setShowSwapDialog] = useState(false);
  const [swapForm, setSwapForm] = useState({ target_staff_id: "", requested_date: "", note: "" });

  const fetchData = async () => {
    try {
      const requests = [
        axios.get(`${API_URL}/api/bills`, {
          withCredentials: true,
          params: { limit: 50 },
        }),
        fulfillmentService.fetchTableManagement({ includeHistory: true }),
      ];
      if (user?.permissions?.includes("shift_swaps")) {
        requests.push(axios.get(`${API_URL}/api/staff`, { withCredentials: true }));
        requests.push(axios.get(`${API_URL}/api/shift-swaps`, { withCredentials: true }));
      }
      const responses = await Promise.all(requests);
      const [billsRes, tableManagementRes, staffRes, swapsRes] = responses;
      const reservations = enrichReservations(
        tableManagementRes?.reservations?.items || [],
        tableManagementRes?.tables?.items || [],
      );
      setBills(toArrayPayload(billsRes.data));
      setReservations(reservations);
      setStaff(toArrayPayload(staffRes?.data));
      setSwapRequests(toArrayPayload(swapsRes?.data));
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchData);

  const dineInBills = useMemo(
    () => bills.filter((bill) => bill.created_by === user?.id && (bill.order_type || "Dine-In") === "Dine-In"),
    [bills, user?.id]
  );
  const allDineInBills = useMemo(
    () => bills.filter((bill) => (bill.order_type || "Dine-In") === "Dine-In"),
    [bills]
  );
  const readyBills = useMemo(
    () => allDineInBills.filter((bill) => (bill.kitchen_status || "pending") === "ready"),
    [allDineInBills]
  );
  const activeTables = useMemo(
    () => dineInBills.filter((bill) => (bill.kitchen_status || "pending") !== "served"),
    [dineInBills]
  );
  const waiterOptions = useMemo(
    () => staff.filter((member) => member.role === "Waiter" && member.active && member.id !== user?.id),
    [staff, user?.id]
  );
  const activeReservations = useMemo(
    () => reservations.filter((reservation) => ACTIVE_RESERVATION_STATUSES.has(String(reservation.status || "").toLowerCase())),
    [reservations]
  );
  const reservationHistory = useMemo(
    () =>
      reservations
        .filter((reservation) => !ACTIVE_RESERVATION_STATUSES.has(String(reservation.status || "").toLowerCase()))
        .slice(0, 10),
    [reservations]
  );

  const submitSwapRequest = async (event) => {
    event.preventDefault();
    try {
      await axios.post(
        `${API_URL}/api/shift-swaps`,
        {
          target_staff_id: swapForm.target_staff_id,
          requested_for: new Date(`${swapForm.requested_date}T09:00:00`).toISOString(),
          note: swapForm.note || null,
        },
        { withCredentials: true }
      );
      toast.success("Shift swap request sent for manager approval");
      setShowSwapDialog(false);
      setSwapForm({ target_staff_id: "", requested_date: "", note: "" });
      fetchData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to create shift swap request"));
    }
  };

  const updateStatus = async (billId, kitchenStatus) => {
    try {
      await axios.put(`${API_URL}/api/bills/${billId}/kitchen-status`, { kitchen_status: kitchenStatus }, { withCredentials: true });
      toast.success(`Order marked as ${kitchenStatus}`);
      fetchData();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Unable to update order status"));
    }
  };

  if (loading) {
    return (
      <Layout title="Waiter Screen">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading waiter screen...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (loadError) {
    return (
      <Layout title="Waiter Screen">
        <div className="cf-page">
          <ApiErrorPanel error={loadError} onRetry={fetchData} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Waiter Screen">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Waiter Service Screen</h1>
            <p>Manage dine-in tables, monitor ready orders, and move guests smoothly from service to served.</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" onClick={fetchData} type="button">Refresh</button>
            <button className="cf-btn cf-btn--primary" onClick={() => navigate("/billing")} type="button">Open Billing</button>
          </div>
        </div>

        <div className="cf-metrics">
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/waiter/reservations")} type="button">
            <div className="cf-metric__label">Reserved Tables</div>
            <div className="cf-metric__value">{activeReservations.length}</div>
            <div className="cf-metric__sub">Tables booked and waiting</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/waiter/active")} type="button">
            <div className="cf-metric__label">Active Dine-In Orders</div>
            <div className="cf-metric__value">{activeTables.length}</div>
            <div className="cf-metric__sub">Not yet marked served</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/waiter/ready")} type="button">
            <div className="cf-metric__label">Orders Ready</div>
            <div className="cf-metric__value">{readyBills.length}</div>
            <div className="cf-metric__sub">Waiting to be delivered</div>
          </button>
          {user?.permissions?.includes("shift_swaps") ? (
            <button className="cf-metric cf-metric--button" onClick={() => setShowSwapDialog(true)} type="button">
              <div className="cf-metric__label">Shift Swap Requests</div>
              <div className="cf-metric__value">{swapRequests.filter((item) => item.status === "pending").length}</div>
              <div className="cf-metric__sub">Raise 2-3 days before the shift</div>
            </button>
          ) : null}
        </div>

        <div className="cf-dashboard-grid">
          <div className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Table Reservations</span>
              <span className="cf-card__meta">Who is seated or expected</span>
            </div>
            <div className="cf-kitchen-list">
              {reservations.length ? (
                reservations.slice(0, 10).map((reservation) => (
                  <div className="cf-kitchen-list__item" key={reservation.id}>
                    <div>
                      <div className="cf-kitchen-list__title">{reservation.table_label}</div>
                      <div className="cf-kitchen-list__meta">
                        {reservation.customer_name || "Walk-in"} | {reservation.guests_count || "-"} guests
                        {reservation.area_name ? ` | ${reservation.area_name}` : ""}
                        {reservation.table_category ? ` | ${reservation.table_category}` : ""}
                        {reservation.table_code ? ` | ${reservation.table_code}` : ""}
                        {reservation.source ? ` | ${reservation.source}` : ""}
                        {reservation.status ? ` | ${reservation.status}` : ""}
                      </div>
                    </div>
                    <div className="cf-kitchen-list__stats">
                      <span>{reservation.notes || "No notes"}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="cf-empty-state">No current reservations.</div>
              )}
            </div>
          </div>

          <div className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Ready to Serve</span>
              <span className="cf-card__meta">Chef has marked these orders ready</span>
            </div>
            <div className="cf-kitchen-list">
              {readyBills.length ? (
                readyBills.map((bill) => (
                  <div className="cf-kitchen-list__item" key={bill.id}>
                    <div>
                      <div className="cf-kitchen-list__title">{bill.table_label || "Counter"} | {bill.customer_name || "Walk-in"}</div>
                      <div className="cf-kitchen-list__meta">
                        {(bill.items || []).map((item) => item.name).join(", ")}
                        {" | "}
                        <span className={waiterOwnershipClass(bill, user)}>{waiterOwnershipLabel(bill, user)}</span>
                      </div>
                    </div>
                    <div className="cf-kitchen-list__stats">
                      <button className="cf-btn cf-btn--primary cf-btn--small" onClick={() => updateStatus(bill.id, "served")} type="button">Mark Served</button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="cf-empty-state">No ready orders at the moment.</div>
              )}
            </div>
          </div>

          <div className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Reservation History</span>
              <span className="cf-card__meta">Released and canceled records now visible to service staff.</span>
            </div>
            <div className="cf-kitchen-list">
              {reservationHistory.length ? (
                reservationHistory.map((reservation) => (
                  <div className="cf-kitchen-list__item" key={reservation.id}>
                    <div>
                      <div className="cf-kitchen-list__title">{reservation.table_label || "Table"}</div>
                      <div className="cf-kitchen-list__meta">
                        {reservation.customer_name || "Walk-in"}
                        {reservation.area_name ? ` | ${reservation.area_name}` : ""}
                        {reservation.table_category ? ` | ${reservation.table_category}` : ""}
                        {reservation.released_at ? ` | Released ${new Date(reservation.released_at).toLocaleString("en-IN")}` : ""}
                        {reservation.canceled_at ? ` | Canceled ${new Date(reservation.canceled_at).toLocaleString("en-IN")}` : ""}
                      </div>
                    </div>
                    <div className="cf-kitchen-list__stats">
                      <span>
                        {reservation.reservation_history_count > 0
                          ? `${reservation.reservation_history_count} past visits`
                          : reservation.source || reservation.status || "history"}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="cf-empty-state">No recent reservation history.</div>
              )}
            </div>
          </div>
        </div>

        <div className="cf-table-wrap" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Dine-In Order Tracker</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Table</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {activeTables.length ? (
                activeTables.map((bill) => (
                  <tr key={bill.id}>
                    <td>{bill.table_label || "-"}</td>
                    <td>{bill.customer_name || "Walk-in"}</td>
                    <td>{(bill.items || []).map((item) => `${item.name} x${item.quantity}`).join(", ")}</td>
                    <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                    <td>
                      <span className={statusBadgeClass(bill.kitchen_status)}>{bill.kitchen_status || "pending"}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No active dine-in orders.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog onOpenChange={setShowSwapDialog} open={showSwapDialog}>
        <DialogContent className="bg-white" style={{ maxWidth: 720 }}>
          <DialogHeader>
            <DialogTitle className="cf-dialog__title">Request Waiter Shift Swap</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitSwapRequest}>
            <div className="cf-field">
              <label>Switch With</label>
              <select className="cf-select" required value={swapForm.target_staff_id} onChange={(event) => setSwapForm({ ...swapForm, target_staff_id: event.target.value })}>
                <option value="">Select waiter</option>
                {waiterOptions.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </div>
            <div className="cf-field">
              <label>Shift Date</label>
              <input className="cf-input" required type="date" value={swapForm.requested_date} onChange={(event) => setSwapForm({ ...swapForm, requested_date: event.target.value })} />
            </div>
            <div className="cf-field">
              <label>Reason</label>
              <textarea className="cf-textarea" rows={3} value={swapForm.note} onChange={(event) => setSwapForm({ ...swapForm, note: event.target.value })} />
            </div>
            <div className="cf-card__meta" style={{ marginBottom: 16 }}>
              Manager or owner approval is required, and requests must be raised at least 2 days before the shift.
            </div>
            <DialogFooter className="cf-dialog-actions">
              <button className="cf-btn cf-btn--secondary" onClick={() => setShowSwapDialog(false)} type="button">Cancel</button>
              <button className="cf-btn cf-btn--primary" type="submit">Request Approval</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

