import React, { useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { toast } from "sonner";

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
  const { metric } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [loadErrorShown, setLoadErrorShown] = useState(false);

  const fetchSnapshot = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/central-kitchen`, { withCredentials: true }).catch(() => ({
        data: EMPTY_SNAPSHOT,
      }));
      setSnapshot(response.data || EMPTY_SNAPSHOT);
    } catch (error) {
      if (!loadErrorShown) {
        toast.error("Central kitchen details loaded with partial data");
        setLoadErrorShown(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchSnapshot);

  const meta = METRIC_META[metric] || METRIC_META.outlets;

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
              {(snapshot.purchase_orders || []).length ? (
                snapshot.purchase_orders.map((order) => (
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
              {(snapshot.route_plans || []).length ? (
                snapshot.route_plans.map((route) => (
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
                    <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                    <td className="cf-table__mono">{item.conversion_cost || 0}</td>
                    <td className="cf-table__mono">{Number(item.current_stock || 0) * Number(item.conversion_cost || 0)}</td>
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
                    <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                    <td className="cf-table__mono">{item.avg_daily_consumption || 0} {item.unit}</td>
                    <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>Kitchen stock is healthy right now.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    if (metric === "restocks") {
      return (
        <div className="cf-table-wrap">
          <div className="cf-section-title">Recent Restocks</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Item</th>
                <th>Qty</th>
                <th>ETA</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot.restock_logs || []).length ? (
                snapshot.restock_logs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.outlet_name}</td>
                    <td>{log.inventory_name}</td>
                    <td className="cf-table__mono">{log.quantity} {log.unit}</td>
                    <td>{log.eta || "-"}</td>
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

