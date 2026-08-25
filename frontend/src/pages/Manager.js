import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { toast } from "sonner";
import { formatCurrency } from "../lib/pos";
import { useUi } from "../contexts/UiContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

const API_URL = process.env.REACT_APP_BACKEND_URL;

export const Manager = () => {
  const navigate = useNavigate();
  const { settings } = useUi();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [feedback, setFeedback] = useState({ items: [], summary: {} });
  const [inventory, setInventory] = useState({ items: [], at_risk_items: [] });
  const [swapRequests, setSwapRequests] = useState([]);
  const [loadErrorShown, setLoadErrorShown] = useState(false);

  const fetchData = async () => {
    try {
      const [statsRes, feedbackRes, inventoryRes, swapRes] = await Promise.all([
        axios.get(`${API_URL}/api/dashboard/stats`, { withCredentials: true }).catch(() => ({ data: {} })),
        axios.get(`${API_URL}/api/feedback`, { withCredentials: true }).catch(() => ({ data: { items: [], summary: {} } })),
        axios.get(`${API_URL}/api/inventory`, { withCredentials: true }).catch(() => ({ data: { items: [], at_risk_items: [] } })),
        axios.get(`${API_URL}/api/shift-swaps`, { withCredentials: true }).catch(() => ({ data: [] })),
      ]);
      setStats(statsRes.data || {});
      setFeedback(feedbackRes.data || { items: [], summary: {} });
      setInventory(inventoryRes.data || { items: [], at_risk_items: [] });
      setSwapRequests(swapRes.data || []);
    } catch (error) {
      if (!loadErrorShown) {
        toast.error("Manager screen loaded with partial data");
        setLoadErrorShown(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchData);

  if (loading) {
    return (
      <Layout title="Manager Screen">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading manager view...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const recentBills = stats?.recent_bills || [];
  const outletSales = stats?.sales_by_outlet || [];
  const lowStock = stats?.low_stock_products || [];
  const riskItems = inventory?.at_risk_items || [];
  const pendingSwapRequests = swapRequests.filter((item) => item.status === "pending");

  const updateSwapStatus = async (requestId, status) => {
    try {
      await axios.put(`${API_URL}/api/shift-swaps/${requestId}`, { status }, { withCredentials: true });
      toast.success(`Shift swap ${status}`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to update shift swap");
    }
  };

  return (
    <Layout title="Manager Screen">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Manager Operations</h1>
            <p>Monitor sales, outlet performance, stock risks, and customer sentiment from one focused screen.</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--primary" onClick={() => navigate("/billing")} type="button">
              Open Billing
            </button>
          </div>
        </div>

        <div className="cf-metrics">
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/manager/sales")} type="button">
            <div className="cf-metric__label">Sales Today</div>
            <div className="cf-metric__value">{formatCurrency(stats?.total_sales_today || 0, settings.currency)}</div>
            <div className="cf-metric__sub">{stats?.bills_count_today || 0} bills processed</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/manager/rating")} type="button">
            <div className="cf-metric__label">Customer Rating</div>
            <div className="cf-metric__value">{feedback.summary?.average_rating || 0}</div>
            <div className="cf-metric__sub">{feedback.summary?.count || 0} responses collected</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/manager/inventory")} type="button">
            <div className="cf-metric__label">Inventory Risks</div>
            <div className="cf-metric__value">{riskItems.length}</div>
            <div className="cf-metric__sub">Items needing attention today</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/manager/online")} type="button">
            <div className="cf-metric__label">Online Orders</div>
            <div className="cf-metric__value">{stats?.online_orders_count || 0}</div>
            <div className="cf-metric__sub">{formatCurrency(stats?.online_sales || 0, settings.currency)} in online sales</div>
          </button>
          <button className="cf-metric cf-metric--button" onClick={() => navigate("/manager/swaps")} type="button">
            <div className="cf-metric__label">Shift Swap Requests</div>
            <div className="cf-metric__value">{pendingSwapRequests.length}</div>
            <div className="cf-metric__sub">Awaiting manager or owner approval</div>
          </button>
        </div>

        <div className="cf-dashboard-grid">
          <div className="cf-table-wrap">
            <div className="cf-section-title">Outlet Performance</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Bills</th>
                  <th>Sales</th>
                </tr>
              </thead>
              <tbody>
                {outletSales.length ? (
                  outletSales.map((outlet) => (
                    <tr key={`${outlet.outlet_name}-${outlet.outlet_id || "na"}`}>
                      <td>{outlet.outlet_name}</td>
                      <td className="cf-table__mono">{outlet.bills}</td>
                      <td className="cf-table__mono">{formatCurrency(outlet.sales, settings.currency)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" style={{ color: "var(--cf-text-3)" }}>No outlet sales snapshot yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Low Stock Products</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.length ? (
                  lowStock.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.category || "Other"}</td>
                      <td className="cf-table__mono">{product.stock}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" style={{ color: "var(--cf-text-3)" }}>No finished goods are low in stock.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cf-dashboard-grid" style={{ marginTop: 24 }}>
          <div className="cf-table-wrap">
            <div className="cf-section-title">Recent Bills</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentBills.length ? (
                  recentBills.map((bill) => (
                    <tr key={bill.id}>
                      <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                      <td>{bill.customer_name || "Walk-in"}</td>
                      <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                      <td style={{ textTransform: "capitalize" }}>{bill.kitchen_status || "pending"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No bills generated yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Inventory Alerts</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Stock</th>
                  <th>Days Left</th>
                </tr>
              </thead>
              <tbody>
                {riskItems.length ? (
                  riskItems.slice(0, 8).map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                      <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="3" style={{ color: "var(--cf-text-3)" }}>No active inventory alerts.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cf-table-wrap" style={{ marginTop: 24 }}>
          <div className="cf-section-title">Waiter Shift Swap Requests</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Requester</th>
                <th>Requested Swap</th>
                <th>Date</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {swapRequests.length ? (
                swapRequests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.requester_name}</td>
                    <td>{request.target_staff_name}</td>
                    <td className="cf-table__mono">{new Date(request.requested_for).toLocaleDateString("en-IN")}</td>
                    <td>{request.note || "-"}</td>
                    <td style={{ textTransform: "capitalize" }}>{request.status}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={request.status !== "pending"} onClick={() => updateSwapStatus(request.id, "approved")} type="button">
                        Approve
                      </button>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={request.status !== "pending"} onClick={() => updateSwapStatus(request.id, "rejected")} type="button">
                        Reject
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ color: "var(--cf-text-3)" }}>No waiter shift swap requests yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
};
