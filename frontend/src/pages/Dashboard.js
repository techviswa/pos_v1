import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { formatCurrency } from "../lib/pos";
import { useUi } from "../contexts/UiContext";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
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

export const Dashboard = () => {
  const { settings } = useUi();
  const { selectedOutlet, selectedOutletId } = useActiveOutlet();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [admincoreLink, setAdmincoreLink] = useState(null);
  const [loadErrorShown, setLoadErrorShown] = useState(false);

  const fetchData = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/dashboard/stats`, {
        withCredentials: true,
        params: selectedOutletId ? { outlet_id: selectedOutletId } : {},
      }).catch(() => ({ data: {} }));
      setStats(response.data || {});
    } catch (error) {
      if (!loadErrorShown) {
        toast.error("Dashboard loaded with partial data");
        setLoadErrorShown(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void fetchData();
    // We only want to react to outlet changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutletId]);

  useEffect(() => {
    let isMounted = true;

    const fetchAdmincoreLink = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/admincore/health`, {
          withCredentials: true,
        });
        if (isMounted && response.data?.connected && response.data?.admincore_reachable) {
          setAdmincoreLink(response.data);
        }
      } catch (_error) {
        if (isMounted) {
          setAdmincoreLink(null);
        }
      }
    };

    void fetchAdmincoreLink();

    return () => {
      isMounted = false;
    };
  }, []);

  const topSelling = stats?.top_selling || [];
  const recentBills = stats?.recent_bills || [];
  const lowStock = stats?.low_stock_products || [];
  const onlineOrders = stats?.recent_online_orders || [];
  const outletSales = stats?.sales_by_outlet || [];
  const inventorySummary = stats?.inventory_summary || {};
  const recipeAnalytics = stats?.recipe_analytics || {};
  const centralKitchen = stats?.central_kitchen || {};
  const routePlans = centralKitchen.route_plans || [];
  const purchaseOrders = centralKitchen.purchase_orders || [];
  const restockLogs = centralKitchen.restock_logs || [];

  const metrics = [
    {
      id: "sales",
      label: "Sales Today",
      value: formatCurrency(stats?.total_sales_today || 0, settings.currency),
      sub: `${stats?.bills_count_today || 0} bills processed today`,
      variant: "is-up",
    },
    {
      id: "online",
      label: "Online Orders",
      value: `${stats?.online_orders_count || 0}`,
      sub: `${formatCurrency(stats?.online_sales || 0, settings.currency)} booked from delivery and web channels`,
    },
    {
      id: "inventory",
      label: "Inventory Watch",
      value: `${inventorySummary.at_risk_count || 0}`,
      sub: `${inventorySummary.expiry_alert_count || 0} expiry alerts, ${inventorySummary.wastage_last_30_days || 0} wastage in 30d`,
      variant: (inventorySummary.at_risk_count || 0) > 0 ? "is-warn" : "",
    },
    {
      id: "recipes",
      label: "Recipe Control",
      value: `${recipeAnalytics.recipe_product_count || 0}`,
      sub: `${recipeAnalytics.blocked_product_count || 0} blocked by ingredients, ${recipeAnalytics.recipe_coverage_percent || 0}% menu recipe-tracked`,
      variant: (recipeAnalytics.blocked_product_count || 0) > 0 ? "is-warn" : "",
    },
    {
      id: "outlets",
      label: "Outlet Operations",
      value: `${centralKitchen.overview?.total_outlets || 0}`,
      sub: `${centralKitchen.overview?.open_purchase_orders || 0} open POs, ${centralKitchen.overview?.scheduled_routes || 0} active routes`,
    },
    {
      id: "revenue",
      label: "Total Revenue",
      value: formatCurrency(stats?.total_revenue || 0, settings.currency),
      sub: Number(stats?.revenue_summary?.goods_cost || 0) > 0
        ? `${formatCurrency(stats?.revenue_summary?.gross_profit || 0, settings.currency)} gross profit at ${stats?.revenue_summary?.margin_percent || 0}% margin`
        : "Update goods cost in Products to unlock true profit",
    },
  ];

  const maxQuantity = Math.max(...topSelling.map((entry) => entry.quantity), 1);

  if (loading) {
    return (
      <Layout title={selectedOutlet ? `Dashboard · ${selectedOutlet.name}` : "Dashboard"}>
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={selectedOutlet ? `Dashboard · ${selectedOutlet.name}` : "Dashboard"}>
      <div className="cf-page" data-testid="dashboard-page">
        <div className="cf-page__overline">Single Screen Monitoring</div>

        <div className="cf-dashboard-hero">
          <div>
            <h1>Single Dashboard Monitoring</h1>
            <p>
              Accept orders, monitor inventory, track routes, review outlet-wise sales, and spot issues across your
              bakery operation from one screen.
            </p>
          </div>
          <div className="cf-dashboard-hero__chips">
            {admincoreLink ? (
              <span className="cf-badge cf-badge--green">Linked to AdminCore</span>
            ) : null}
            <span className="cf-badge cf-badge--blue">{centralKitchen.overview?.restocks_this_week || 0} restocks this week</span>
            <span className="cf-badge cf-badge--green">{stats?.cashier_count || 0} active cashiers</span>
            <span className="cf-badge cf-badge--amber">{inventorySummary.expiry_alert_count || 0} expiry alerts</span>
          </div>
        </div>

        <div className="cf-metrics">
          {metrics.map((metric) => (
            <button className="cf-metric cf-metric--button" key={metric.label} onClick={() => navigate(`/dashboard/${metric.id}`)} type="button">
              <div className="cf-metric__label">{metric.label}</div>
              <div className="cf-metric__value">{metric.value}</div>
              <div className={`cf-metric__sub ${metric.variant || ""}`}>{metric.sub}</div>
            </button>
          ))}
        </div>

        <div className="cf-dashboard-grid">
          <div className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Top Selling Products</span>
              <span className="cf-card__meta">quantity sold across all bills</span>
            </div>
            <div className="cf-chart-bars">
              {topSelling.length ? (
                topSelling.map((item) => (
                  <div className="cf-chart-bar" key={item.name}>
                    <div className="cf-chart-bar__value">{item.quantity}</div>
                    <div className="cf-chart-bar__fill" style={{ height: `${Math.max((item.quantity / maxQuantity) * 100, 8)}px` }} />
                    <div className="cf-chart-bar__label">{item.name}</div>
                  </div>
                ))
              ) : (
                <p className="cf-card__meta">No product data yet.</p>
              )}
            </div>
          </div>

          <div className="cf-card cf-card--padded">
            <div className="cf-card__title">
              <span>Outlet Sales Snapshot</span>
              <span className="cf-card__meta">every outlet, every sale trend</span>
            </div>
            <div className="cf-kitchen-list">
              {outletSales.length ? (
                outletSales.map((outlet) => (
                  <div className="cf-kitchen-list__item" key={`${outlet.outlet_name}-${outlet.outlet_id || "na"}`}>
                    <div>
                      <div className="cf-kitchen-list__title">{outlet.outlet_name}</div>
                      <div className="cf-kitchen-list__meta">{outlet.bills} bills logged</div>
                    </div>
                    <div className="cf-kitchen-list__stats">
                      <span>{formatCurrency(outlet.sales, settings.currency)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="cf-empty-state">No outlet-wise sales mapped yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="cf-dashboard-grid" style={{ marginTop: 24 }}>
          <div className="cf-table-wrap">
            <div className="cf-section-title">Online Orders and Delivery Queue</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Channel</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {onlineOrders.length ? (
                  onlineOrders.map((bill) => (
                    <tr key={bill.id}>
                      <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                      <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                      <td>{bill.payment_type}</td>
                      <td>{new Date(bill.created_at).toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No online or delivery orders detected yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Inventory Risk and Expiry</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Stock</th>
                  <th>Days Left</th>
                  <th>Expiry</th>
                </tr>
              </thead>
              <tbody>
                {(inventorySummary.at_risk_items || []).length ? (
                  (inventorySummary.at_risk_items || []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                      <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                      <td className="cf-table__mono">{item.expiry_date ? item.expiry_date.slice(0, 10) : "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No inventory risks right now.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cf-dashboard-grid" style={{ marginTop: 24 }}>
          <div className="cf-table-wrap">
            <div className="cf-section-title">Recipe Analytics</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Recipe Cost</th>
                  <th>Recipe Nodes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(recipeAnalytics.top_recipe_cost_products || []).length ? (
                  (recipeAnalytics.top_recipe_cost_products || []).map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td className="cf-table__mono">
                        {formatCurrency(
                          Number(product.base_recipe_cost || 0) + Number(product.variation_recipe_cost || 0) + Number(product.addon_recipe_cost || 0),
                          settings.currency
                        )}
                      </td>
                      <td className="cf-table__mono">{product.total_recipe_nodes || 0}</td>
                      <td>{product.ingredient_blocked ? "Blocked" : "Ready"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No recipe analytics yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Recent Bills</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Bill #</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {recentBills.length ? (
                  recentBills.map((bill) => (
                    <tr key={bill.id}>
                      <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                      <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                      <td>{bill.payment_type}</td>
                      <td>{new Date(bill.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
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
            <div className="cf-section-title">Low Stock Finished Goods</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Qty</th>
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
                    <td colSpan="3" style={{ color: "var(--cf-text-3)" }}>Finished goods inventory is healthy.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="cf-dashboard-grid" style={{ marginTop: 24 }}>
          <div className="cf-table-wrap">
            <div className="cf-section-title">Open Purchase Orders</div>
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
                {purchaseOrders.length ? (
                  purchaseOrders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.outlet_name}</td>
                      <td>{order.priority}</td>
                      <td>{order.status}</td>
                      <td className="cf-table__mono">{order.items?.length || 0}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No purchase orders open.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="cf-table-wrap">
            <div className="cf-section-title">Delivery Routes and Restocks</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Route / Outlet</th>
                  <th>Status</th>
                  <th>Stops / Qty</th>
                  <th>Dispatch</th>
                </tr>
              </thead>
              <tbody>
                {routePlans.length ? (
                  routePlans.map((route) => (
                    <tr key={route.id}>
                      <td>{route.route_name}</td>
                      <td>{route.status}</td>
                      <td className="cf-table__mono">{route.stops?.length || 0} stops</td>
                      <td>{route.dispatch_date || "-"}</td>
                    </tr>
                  ))
                ) : restockLogs.length ? (
                  restockLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{log.outlet_name}</td>
                      <td>Restocked</td>
                      <td className="cf-table__mono">{log.quantity} {log.unit}</td>
                      <td>{log.route_name || log.eta || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No routes or restocks scheduled yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
};

