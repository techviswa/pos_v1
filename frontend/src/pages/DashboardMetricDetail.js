import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { formatCurrency } from "../lib/pos";
import { useUi } from "../contexts/UiContext";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";

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
  sales: {
    title: "Sales Today",
    description: "Every bill recorded today with customer, amount, and timestamp details.",
  },
  online: {
    title: "Online Orders",
    description: "All detected online or delivery-linked orders and their bill values.",
  },
  inventory: {
    title: "Inventory Watch",
    description: "At-risk inventory, expiry alerts, and stock pressure requiring attention.",
  },
  recipes: {
    title: "Recipe Analytics",
    description: "Recipe coverage, ingredient-led blockers, auto-costing visibility, and ingredient usage trends.",
  },
  outlets: {
    title: "Outlet Operations",
    description: "Outlet-wise sales, open purchase orders, routes, and restock activity.",
  },
  revenue: {
    title: "Total Revenue Summary",
    description: "A focused revenue breakdown across time windows and service channels.",
  },
};

export const DashboardMetricDetail = () => {
  const { metric } = useParams();
  const navigate = useNavigate();
  const { settings } = useUi();
  const { selectedOutletId } = useActiveOutlet();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState("all");

  const fetchData = async () => {
    try {
      const statsRes = await axios.get(`${API_URL}/api/dashboard/stats`, {
        withCredentials: true,
        params: {
          period,
          ...(selectedOutletId ? { outlet_id: selectedOutletId } : {}),
        },
      });
      setStats(statsRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void fetchData();
    // Fetch again when the period or outlet changes so the summary and rows stay in lockstep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, selectedOutletId]);

  const meta = METRIC_META[metric] || METRIC_META.sales;
  const centralKitchen = stats?.central_kitchen || {};
  const outletSales = stats?.sales_by_outlet || [];
  const inventorySummary = stats?.inventory_summary || {};
  const recipeAnalytics = stats?.recipe_analytics || {};
  const routePlans = centralKitchen.route_plans || [];
  const restockLogs = centralKitchen.restock_logs || [];
  const purchaseOrders = centralKitchen.purchase_orders || [];
  const revenueDetail = stats?.revenue_detail || {};
  const filteredRevenueBills = revenueDetail.bills || [];
  const revenueSummary = {
    revenue: Number(revenueDetail.revenue || 0),
    goodsCost: Number(revenueDetail.goods_cost || 0),
    grossProfit: Number(revenueDetail.gross_profit || 0),
    marginPercent: Number(revenueDetail.margin_percent || 0),
    onlineRevenue: Number(revenueDetail.online_revenue || 0),
    dineInRevenue: Number(revenueDetail.dine_in_revenue || 0),
    orderCount: Number(revenueDetail.order_count || 0),
    avgOrderValue: Number(revenueDetail.avg_order_value || 0),
  };

  const revenueRows = [
    { label: "Revenue", value: revenueSummary.revenue },
    { label: "Goods Cost", value: revenueSummary.goodsCost },
    { label: "Gross Profit", value: revenueSummary.grossProfit },
    { label: "Margin %", value: revenueSummary.marginPercent, isPercent: true },
    { label: "Online Revenue", value: revenueSummary.onlineRevenue },
    { label: "Dine-In Revenue", value: revenueSummary.dineInRevenue },
    { label: "Orders", value: revenueSummary.orderCount, isCount: true },
    { label: "Avg Order Value", value: revenueSummary.avgOrderValue },
  ];

  if (loading) {
    return (
      <Layout title={meta.title}>
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading detail view...</p>
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
            <button className="cf-btn cf-btn--secondary" onClick={() => navigate("/dashboard")} type="button">
              Back to Dashboard
            </button>
          </div>
        </div>

        {metric === "sales" ? (
          <div className="cf-table-wrap">
            <div className="cf-section-title">Today&apos;s Bills</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.today_bills || []).length ? (
                  (stats?.today_bills || []).map((bill) => (
                    <tr key={bill.id}>
                      <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                      <td>{bill.customer_name || "Walk-in"}</td>
                      <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                      <td>{bill.payment_type}</td>
                      <td>{new Date(bill.created_at).toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No sales recorded today.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : metric === "online" ? (
          <div className="cf-table-wrap">
            <div className="cf-section-title">Online and Delivery Orders</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Channel</th>
                  <th>Amount</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.online_orders_details || []).length ? (
                  (stats?.online_orders_details || []).map((bill) => (
                    <tr key={bill.id}>
                      <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                      <td>{bill.customer_name || "Online customer"}</td>
                      <td>{bill.payment_type}</td>
                      <td className="cf-table__mono">{formatCurrency(bill.total, settings.currency)}</td>
                      <td>{new Date(bill.created_at).toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No online orders available.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : metric === "inventory" ? (
          <div className="cf-dashboard-grid">
            <div className="cf-table-wrap">
              <div className="cf-section-title">At-Risk Inventory</div>
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
                    <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No at-risk inventory right now.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="cf-table-wrap">
              <div className="cf-section-title">Expiry Alerts</div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Stock</th>
                    <th>Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {(inventorySummary.expiry_alerts || []).length ? (
                    (inventorySummary.expiry_alerts || []).map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                        <td className="cf-table__mono">{item.expiry_date ? item.expiry_date.slice(0, 10) : "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan="3" style={{ color: "var(--cf-text-3)" }}>No expiry alerts currently.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : metric === "recipes" ? (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="cf-metrics">
              <div className="cf-metric">
                <div className="cf-metric__label">Recipe Products</div>
                <div className="cf-metric__value">{recipeAnalytics.recipe_product_count || 0}</div>
                <div className="cf-metric__sub">{recipeAnalytics.recipe_coverage_percent || 0}% of the menu is recipe-tracked</div>
              </div>
              <div className="cf-metric">
                <div className="cf-metric__label">Ingredient Blocked</div>
                <div className="cf-metric__value">{recipeAnalytics.blocked_product_count || 0}</div>
                <div className="cf-metric__sub">Products whose base recipes cannot be produced right now</div>
              </div>
            </div>
            <div className="cf-dashboard-grid">
              <div className="cf-table-wrap">
                <div className="cf-section-title">Highest Recipe Cost Products</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Base Recipe</th>
                      <th>Variation Extras</th>
                      <th>Add-on Extras</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recipeAnalytics.top_recipe_cost_products || []).length ? (
                      (recipeAnalytics.top_recipe_cost_products || []).map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td className="cf-table__mono">{formatCurrency(product.base_recipe_cost || 0, settings.currency)}</td>
                          <td className="cf-table__mono">{formatCurrency(product.variation_recipe_cost || 0, settings.currency)}</td>
                          <td className="cf-table__mono">{formatCurrency(product.addon_recipe_cost || 0, settings.currency)}</td>
                          <td>{product.ingredient_blocked ? "Blocked" : "Ready"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No recipe costing data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="cf-table-wrap">
                <div className="cf-section-title">Top Ingredient Usage</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Used</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recipeAnalytics.top_ingredient_usage || []).length ? (
                      (recipeAnalytics.top_ingredient_usage || []).map((ingredient) => (
                        <tr key={ingredient.inventory_id}>
                          <td>{ingredient.ingredient_name}</td>
                          <td className="cf-table__mono">{ingredient.quantity_used}</td>
                          <td>{ingredient.unit || "-"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="3" style={{ color: "var(--cf-text-3)" }}>No ingredient consumption tracked yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="cf-table-wrap">
              <div className="cf-section-title">Most Ordered Recipe-Tracked Products</div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Orders</th>
                    <th>Recipe Nodes</th>
                    <th>Available Units</th>
                  </tr>
                </thead>
                <tbody>
                  {(recipeAnalytics.most_ordered_recipe_products || []).length ? (
                    (recipeAnalytics.most_ordered_recipe_products || []).map((product) => (
                      <tr key={product.id}>
                        <td>{product.name}</td>
                        <td className="cf-table__mono">{product.orders_with_recipe || 0}</td>
                        <td className="cf-table__mono">{product.total_recipe_nodes || 0}</td>
                        <td className="cf-table__mono">{product.available_units ?? "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No recipe-order history yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : metric === "outlets" ? (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="cf-table-wrap">
              <div className="cf-section-title">Outlet Performance</div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Outlet</th>
                    <th>Bills</th>
                    <th>Sales</th>
                    <th>Open POs</th>
                  </tr>
                </thead>
                <tbody>
                  {outletSales.length ? (
                    outletSales.map((outlet) => {
                      const outletMeta = (centralKitchen.outlets || []).find((entry) => entry.id === outlet.outlet_id || entry.name === outlet.outlet_name);
                      return (
                        <tr key={`${outlet.outlet_name}-${outlet.outlet_id || "na"}`}>
                          <td>{outlet.outlet_name}</td>
                          <td className="cf-table__mono">{outlet.bills}</td>
                          <td className="cf-table__mono">{formatCurrency(outlet.sales, settings.currency)}</td>
                          <td className="cf-table__mono">{outletMeta?.open_purchase_orders || 0}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No outlet operation data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="cf-dashboard-grid">
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
                    {purchaseOrders.length ? purchaseOrders.map((order) => (
                      <tr key={order.id}>
                        <td>{order.outlet_name}</td>
                        <td>{order.priority}</td>
                        <td>{order.status}</td>
                        <td className="cf-table__mono">{order.items?.length || 0}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No purchase orders open.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="cf-table-wrap">
                <div className="cf-section-title">Routes and Restocks</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Route / Outlet</th>
                      <th>Status</th>
                      <th>Stops / Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...routePlans, ...restockLogs].length ? (
                      [...routePlans.map((route) => ({
                        key: route.id,
                        name: route.route_name,
                        status: route.status,
                        meta: `${route.stops?.length || 0} stops`,
                      })), ...restockLogs.map((restock) => ({
                        key: restock.id,
                        name: restock.outlet_name,
                        status: "Restock",
                        meta: `${restock.quantity} ${restock.unit}`,
                      }))].map((item) => (
                        <tr key={item.key}>
                          <td>{item.name}</td>
                          <td>{item.status}</td>
                          <td>{item.meta}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="3" style={{ color: "var(--cf-text-3)" }}>No outlet route or restock activity yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="cf-table-wrap">
            <div className="cf-table-toolbar">
              <select className="cf-select" onChange={(event) => setPeriod(event.target.value)} style={{ width: 180 }} value={period}>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="all">All Time</option>
              </select>
              <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                Financial summary for the selected period
              </span>
            </div>
            {revenueSummary.goodsCost <= 0 && revenueSummary.revenue > 0 ? (
              <div className="cf-table-toolbar" style={{ borderTop: "1px solid var(--cf-border)" }}>
                <span style={{ color: "var(--cf-text-2)", fontSize: 12 }}>
                  Goods cost is still zero for the products in this period. Update product goods cost to see true profit and margin.
                </span>
              </div>
            ) : null}
            <div className="cf-section-title">Total Revenue Summary</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {revenueRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="cf-table__mono">
                      {row.isPercent ? `${row.value.toFixed(2)}%` : row.isCount ? row.value : formatCurrency(row.value, settings.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="cf-section-title">Bills in Selected Period</div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Customer</th>
                  <th>Revenue</th>
                  <th>Goods Cost</th>
                  <th>Gross Profit</th>
                </tr>
              </thead>
              <tbody>
                {filteredRevenueBills.length ? filteredRevenueBills.map((bill) => {
                  const billGoodsCost = Number(bill.goods_cost || 0);
                  const billRevenue = Number(bill.revenue ?? bill.total ?? 0);
                  return (
                    <tr key={bill.id}>
                      <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                      <td>{bill.customer_name || "Walk-in"}</td>
                      <td className="cf-table__mono">{formatCurrency(billRevenue, settings.currency)}</td>
                      <td className="cf-table__mono">{formatCurrency(billGoodsCost, settings.currency)}</td>
                      <td className="cf-table__mono">{formatCurrency(billRevenue - billGoodsCost, settings.currency)}</td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No bills found for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
};

