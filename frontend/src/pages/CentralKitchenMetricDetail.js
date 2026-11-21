import React, { useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/apiUrl";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { toast } from "sonner";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { apiData } from "../lib/apiData";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatQuantity } from "../lib/quantity";
import { formatCurrency } from "../lib/pos";


const METRIC_META = {
  outlets: {
    title: "Outlets",
    description: "All outlets connected to the central kitchen.",
  },
  "purchase-orders": {
    title: "Open Purchase Orders",
    description: "Outlet demand raised for central kitchen supply.",
  },
  routes: {
    title: "Routes Scheduled",
    description: "Delivery plans and route stop summaries.",
  },
  "stock-value": {
    title: "Kitchen Stock Value",
    description: "Central stock, conversion cost, and item-wise value.",
  },
  risks: {
    title: "Ingredients At Risk",
    description: "Low-stock ingredients that need attention.",
  },
  restocks: {
    title: "Restocks This Week",
    description: "Recent restock activity from the central kitchen.",
  },
};

const EMPTY_SNAPSHOT = {
  overview: {},
  outlets: [],
  central_inventory: [],
  low_stock_items: [],
  purchase_orders: [],
  route_plans: [],
  outlet_inventory: [],
  restock_logs: [],
};

export const CentralKitchenMetricDetail = () => {
  const { selectedOutletId } = useActiveOutlet();
  const scopeRef = useRef(selectedOutletId); scopeRef.current = selectedOutletId;
  const sequenceRef = useRef(0);
  const { metric } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loadErrorShown, setLoadErrorShown] = useState(false);
  useEffect(() => { setLoading(true); setSnapshot(EMPTY_SNAPSHOT); setLoadErrorShown(false); }, [selectedOutletId]);

  const fetchSnapshot = async () => {
    const sequence = ++sequenceRef.current;
    try {
      const response = await axios.get(`${API_URL}/api/central-kitchen`, { withCredentials: true, skipCache: true, params: selectedOutletId ? { outlet_id: selectedOutletId } : {} });
      if (scopeRef.current === selectedOutletId && sequence === sequenceRef.current) { setSnapshot(apiData(response)); setLoadErrorShown(false); }
    } catch (error) {
      if (scopeRef.current === selectedOutletId && sequence === sequenceRef.current && !loadErrorShown) {
        toast.error(getApiErrorMessage(error, "Unable to refresh kitchen details. Last loaded data is retained."));
        setLoadErrorShown(true);
      }
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  };

  useAutoRefresh(fetchSnapshot, { refreshKey: selectedOutletId, refreshOnFocus: true, intervalMs: 30000, liveResources: ["inventory", "outlets"] });

  const meta = METRIC_META[metric] || METRIC_META.outlets;
  const orders = snapshot.purchase_orders.filter((row) => ["pending", "approved", "pending_approval", "dispatched", "in_transit"].includes(row.status));
  const routes = snapshot.route_plans.filter((row) => ["scheduled", "Scheduled", "dispatched", "In Transit"].includes(row.status));
  const restocks = snapshot.restock_logs.filter((row) => ["received", "completed"].includes(row.status) && row.updated_at >= snapshot.week_start);

  const renderContent = () => {
    if (metric === "purchase-orders") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Outlet Purchase Orders</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {orders.length ? (
                orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.outlet_name}</td>
                    <td>{order.priority}</td>
                    <td>{order.status}</td>
                    <td className="cf-table__mono">{order.items?.length || 0}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No purchase orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (metric === "routes") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Delivery Route Plans</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Route</th>
                <th>Dispatch</th>
                <th>Vehicle</th>
                <th>Stops</th>
              </tr>
            </thead>
            <tbody>
              {routes.length ? (
                routes.map((route) => (
                  <tr key={route.id}>
                    <td>{route.route_name}</td>
                    <td>{route.dispatch_date || "-"}</td>
                    <td>{route.vehicle_number || "-"}</td>
                    <td className="cf-table__mono">{route.stops?.length || 0}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No route plans created yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (metric === "stock-value") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Central Inventory Value Breakdown</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Stock</th>
                <th>Conversion Cost</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot.central_inventory || []).length ? (
                snapshot.central_inventory.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="cf-table__mono">{formatQuantity(item.current_stock, item.unit)}</td>
                    <td className="cf-table__mono">{item.conversion_cost == null ? "Not tracked" : formatCurrency(item.conversion_cost)}</td>
                    <td className="cf-table__mono">{item.current_stock == null ? "Not tracked" : formatCurrency(item.current_stock * item.conversion_cost)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No central inventory items available.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (metric === "risks") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Run-Out Forecast</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Stock</th>
                <th>Daily Use</th>
                <th>Days Left</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot.low_stock_items || []).length ? (
                snapshot.low_stock_items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td className="cf-table__mono">{formatQuantity(item.current_stock, item.unit)}</td>
                    <td className="cf-table__mono">{item.usage_history_available ? formatQuantity(item.avg_daily_consumption, item.unit) : "No usage history"}</td>
                    <td className="cf-table__mono">{item.days_remaining == null ? "No estimate" : formatQuantity(item.days_remaining, "days")}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No reorder alerts among tracked ingredients. Untracked stock still needs setup.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (metric === "restocks") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Received transfers since Monday (UTC)</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Items</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {restocks.length ? (
                restocks.map((log) => (
                  <tr key={log.id}>
                    <td>{log.outlet_name}</td>
                    <td>{(log.items || []).map((item) => `${item.inventory_name || "Ingredient"}: ${formatQuantity(item.received_quantity ?? item.approved_quantity ?? item.requested_quantity, item.unit)}`).join(", ")}</td>
                    <td>{log.status.replaceAll("_", " ")}</td>
                    <td>{new Date(log.updated_at).toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No restocks recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="cf-table-wrap">
        <div className="cf-section-title">Outlet Control Tower</div>
        <table className="cf-table">
          <thead>
            <tr>
              <th>Outlet</th>
              <th>Code</th>
              <th>Location</th>
              <th>Window</th>
              <th>Stock Lines</th>
              <th>Open PO</th>
            </tr>
          </thead>
          <tbody>
            {(snapshot.outlets || []).length ? (
              snapshot.outlets.map((outlet) => (
                <tr key={outlet.id}>
                  <td>{outlet.name}</td>
                  <td>{outlet.code}</td>
                  <td>{outlet.location}</td>
                  <td>{outlet.delivery_window || "-"}</td>
                  <td className="cf-table__mono">{outlet.inventory_lines || 0}</td>
                  <td className="cf-table__mono">{outlet.open_purchase_orders || 0}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan="6" style={{ color: "var(--cf-text-3)" }}>No bakery outlets added yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  if (loading) {
    return (
      <Layout title={meta.title}>
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading central kitchen details...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={meta.title}>
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>{meta.title}</h1>
            <p>{meta.description}</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--secondary" onClick={() => navigate("/central-kitchen")} type="button">
              Back to Central Kitchen
            </button>
          </div>
        </div>
        {renderContent()}
      </div>
    </Layout>
  );
};

