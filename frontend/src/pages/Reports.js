import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { formatCurrency, isDateInPeriod } from "../lib/pos";
import { useUi } from "../contexts/UiContext";
import { toast } from "sonner";

const API_URL = process.env.REACT_APP_BACKEND_URL;
const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

const toArrayPayload = (payload) => {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

export const Reports = () => {
  const { settings } = useUi();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("date");
  const [period, setPeriod] = useState("today");
  const [customDateRange, setCustomDateRange] = useState({ from: "", to: "" });
  const [bills, setBills] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [reportOverview, setReportOverview] = useState({});
  const [feedback, setFeedback] = useState({ items: [], summary: {} });
  const [customerAnalytics, setCustomerAnalytics] = useState({
    summary: {},
    customers: [],
    item_sales_by_channel: [],
    campaign_suggestions: [],
  });
  const [loadError, setLoadError] = useState(null);
  const [loadErrorShown, setLoadErrorShown] = useState(false);
  const [feedbackView, setFeedbackView] = useState("responses");
  const [customerView, setCustomerView] = useState("tracked");
  const [recipeView, setRecipeView] = useState("with");

  const fetchData = async () => {
    try {
      const reportParams = (() => {
        if (period === "custom") return { from: customDateRange.from || undefined, to: customDateRange.to || undefined };
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const to = today.toISOString().slice(0, 10);
        if (period === "today") return { from: to, to };
        if (period === "week") {
          const startWeek = new Date(today);
          startWeek.setDate(startWeek.getDate() - startWeek.getDay());
          return { from: startWeek.toISOString().slice(0, 10), to };
        }
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: startMonth.toISOString().slice(0, 10), to };
      })();
      const [reportsRes, billsRes, productsRes, inventoryRes, feedbackRes, customerAnalyticsRes] = await Promise.all([
        axios.get(`${API_URL}/api/reports`, { withCredentials: true, params: reportParams }).catch(() => ({ data: { data: {} } })),
        axios.get(`${API_URL}/api/bills`, { withCredentials: true, params: { limit: 500 } }).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/products`, { withCredentials: true, params: { limit: 500 } }).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/api/inventory`, { withCredentials: true, params: { limit: 500 } }).catch(() => ({ data: { items: [] } })),
        axios.get(`${API_URL}/api/feedback`, { withCredentials: true }).catch(() => ({ data: { items: [], summary: {} } })),
        axios.get(`${API_URL}/api/customer-analytics`, { withCredentials: true }).catch(() => ({
          data: {
            summary: {},
            customers: [],
            item_sales_by_channel: [],
            campaign_suggestions: [],
          },
        })),
      ]);
      setReportOverview(reportsRes.data?.data || reportsRes.data || {});
      setBills(toArrayPayload(billsRes.data));
      setProducts(toArrayPayload(productsRes.data));
      setInventory(toArrayPayload(inventoryRes.data));
      setFeedback(feedbackRes.data || { items: [], summary: {} });
      setCustomerAnalytics(
        customerAnalyticsRes.data || {
          summary: {},
          customers: [],
          item_sales_by_channel: [],
          campaign_suggestions: [],
        }
      );
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
      if (!loadErrorShown) {
        toast.error("Reports loaded with partial data");
        setLoadErrorShown(true);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void fetchData();
    // Reports must refetch when the selected reporting period changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customDateRange.from, customDateRange.to]);

  const filteredBills = useMemo(
    () =>
      bills.filter((bill) => {
        if (period !== "custom") {
          return isDateInPeriod(bill.created_at, period);
        }

        const createdAt = new Date(bill.created_at);
        if (Number.isNaN(createdAt.getTime())) {
          return false;
        }

        if (customDateRange.from) {
          const fromDate = new Date(`${customDateRange.from}T00:00:00`);
          if (createdAt < fromDate) {
            return false;
          }
        }

        if (customDateRange.to) {
          const toDate = new Date(`${customDateRange.to}T23:59:59.999`);
          if (createdAt > toDate) {
            return false;
          }
        }

        return true;
      }),
    [bills, period, customDateRange.from, customDateRange.to]
  );
  const dateRows = reportOverview.sales?.rows || EMPTY_ARRAY;
  const productRows = useMemo(
    () =>
      (reportOverview.profitability?.rows || []).map((row) => ({
        name: row.name,
        cat: row.category,
        qty: row.quantity_sold,
        rev: row.revenue,
      })),
    [reportOverview.profitability?.rows],
  );
  const productTotal = reportOverview.profitability?.summary?.revenue || productRows.reduce((sum, row) => sum + row.rev, 0);
  const inventoryRows = useMemo(
    () =>
      inventory.filter((item) =>
        (item.avg_daily_consumption || 0) > 0 ||
        (item.wastage_last_30_days || 0) > 0 ||
        (item.pilferage_last_30_days || 0) > 0 ||
        item.expiry_date ||
        item.days_remaining !== null
      ),
    [inventory]
  );
  const customerSummary = customerAnalytics.summary || EMPTY_OBJECT;
  const customers = customerAnalytics.customers || EMPTY_ARRAY;
  const itemSalesByChannel = customerAnalytics.item_sales_by_channel || EMPTY_ARRAY;
  const campaignSuggestions = customerAnalytics.campaign_suggestions || EMPTY_ARRAY;
  const feedbackItems = feedback.items || EMPTY_ARRAY;
  const feedbackSummary = {
    responses: feedback.summary?.count ?? feedback.summary?.total_feedback ?? feedbackItems.length,
    average_rating: feedback.summary?.average_rating || 0,
    five_star: feedback.summary?.five_star ?? feedbackItems.filter((item) => Number(item.rating || 0) >= 5).length,
  };
  const feedbackRows = useMemo(() => {
    if (feedbackView === "fiveStar") {
      return feedbackItems.filter((item) => Number(item.rating || 0) >= 5);
    }
    if (feedbackView === "rating") {
      return [...feedbackItems].sort((left, right) => Number(right.rating || 0) - Number(left.rating || 0));
    }
    return feedbackItems;
  }, [feedbackItems, feedbackView]);
  const customerRows = useMemo(() => {
    if (customerView === "repeat") {
      return customers.filter((customer) => Number(customer.visits || 0) >= 2);
    }
    if (customerView === "loyalty") {
      return [...customers].sort((left, right) => Number(right.loyalty_points || 0) - Number(left.loyalty_points || 0));
    }
    if (customerView === "value") {
      return [...customers].sort((left, right) => Number(right.total_spent || 0) - Number(left.total_spent || 0));
    }
    return customers;
  }, [customers, customerView]);
  const recipeAnalytics = useMemo(() => {
    const inventoryStockMap = Object.fromEntries((inventory || []).map((item) => [item.id, Number(item.current_stock || 0)]));
    const recipeProducts = products.filter((product) => (product.recipe_lines || []).length);
    const productsWithAnyRecipe = products.filter((product) =>
      (product.recipe_lines || []).length ||
      (product.variation_options || []).some((option) => (option.recipe_lines || []).length) ||
      (product.addon_options || []).some((option) => (option.recipe_lines || []).length)
    );
    const blockedProducts = products.filter((product) =>
      (product.recipe_lines || []).some((line) => Number(inventoryStockMap[line.inventory_id] || 0) < Number(line.quantity || 0))
    );
    const ingredientDemand = {};
    filteredBills.forEach((bill) => {
      (bill.items || []).forEach((billItem) => {
        const product = products.find((entry) => entry.id === (billItem.productId || billItem.product_id));
        if (!product) return;
        const variation = (product.variation_options || []).find((option) => option.name === billItem.variation);
        const addons = (product.addon_options || []).filter((option) => (billItem.addons || []).includes(option.name));
        const allRecipeLines = [
          ...(product.recipe_lines || []),
          ...(variation?.recipe_lines || []),
          ...addons.flatMap((option) => option.recipe_lines || []),
        ];
        allRecipeLines.forEach((line) => {
          const current = ingredientDemand[line.ingredient_name] || { ingredient_name: line.ingredient_name, unit: line.unit, quantity: 0 };
          current.quantity += Number(line.quantity || 0) * Number(billItem.quantity || 0);
          ingredientDemand[line.ingredient_name] = current;
        });
      });
    });

    return {
      productsWithRecipes: productsWithAnyRecipe.length,
      productsWithoutRecipes: products.filter((product) => !(
        (product.recipe_lines || []).length ||
        (product.variation_options || []).some((option) => (option.recipe_lines || []).length) ||
        (product.addon_options || []).some((option) => (option.recipe_lines || []).length)
      )).length,
      blockedProducts,
      recipeProducts: recipeProducts.map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        auto_recipe_cost: product.auto_recipe_cost || 0,
        price: product.price || product.base_price || 0,
        gross_margin: Number(product.price || product.base_price || 0) - Number(product.auto_recipe_cost || 0),
        base_lines: (product.recipe_lines || []).length,
        variation_lines: (product.variation_options || []).reduce((sum, option) => sum + ((option.recipe_lines || []).length), 0),
        addon_lines: (product.addon_options || []).reduce((sum, option) => sum + ((option.recipe_lines || []).length), 0),
      })),
      ingredientDemand: Object.values(ingredientDemand).sort((left, right) => right.quantity - left.quantity).slice(0, 20),
      missingRecipeProducts: products.filter((product) => !(
        (product.recipe_lines || []).length ||
        (product.variation_options || []).some((option) => (option.recipe_lines || []).length) ||
        (product.addon_options || []).some((option) => (option.recipe_lines || []).length)
      )),
    };
  }, [filteredBills, inventory, products]);

  const segmentBadgeClass = (segment) => {
    if (segment === "VIP") {
      return "cf-badge cf-badge--blue";
    }
    if (segment === "Regular") {
      return "cf-badge cf-badge--green";
    }
    return "cf-badge cf-badge--gray";
  };

  const periodLabel =
    period === "custom"
      ? customDateRange.from || customDateRange.to
        ? `${customDateRange.from || "Start"} to ${customDateRange.to || "Today"}`
        : "Custom Range"
      : period === "today"
        ? "Today"
        : period === "week"
          ? "This Week"
          : "This Month";

  const renderPeriodControls = () => (
    <div className="cf-table-toolbar">
      <select className="cf-select" onChange={(event) => setPeriod(event.target.value)} style={{ width: 180 }} value={period}>
        <option value="today">Today</option>
        <option value="week">This Week</option>
        <option value="month">This Month</option>
        <option value="custom">Custom Range</option>
      </select>
      {period === "custom" ? (
        <>
          <input
            className="cf-search"
            style={{ width: 155 }}
            type="date"
            value={customDateRange.from}
            onChange={(event) => setCustomDateRange((current) => ({ ...current, from: event.target.value }))}
          />
          <input
            className="cf-search"
            style={{ width: 155 }}
            type="date"
            value={customDateRange.to}
            onChange={(event) => setCustomDateRange((current) => ({ ...current, to: event.target.value }))}
          />
        </>
      ) : null}
      <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
        Showing: <b style={{ color: "var(--cf-text)" }}>{periodLabel}</b>
      </span>
    </div>
  );

  if (loading) {
    return (
      <Layout title="Reports">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading reports...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (loadError && !bills.length && !products.length && !inventory.length) {
    return (
      <Layout title="Reports">
        <div className="cf-page">
          <ApiErrorPanel error={loadError} onRetry={fetchData} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Reports">
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>Reports</h1>
            <p>Sales analytics and summaries</p>
          </div>
        </div>

        <div className="cf-tabs">
          <button className={`cf-tab ${activeTab === "date" ? "is-active" : ""}`} onClick={() => setActiveTab("date")}>
            Sales by Date
          </button>
          <button className={`cf-tab ${activeTab === "product" ? "is-active" : ""}`} onClick={() => setActiveTab("product")}>
            Sales by Product
          </button>
          <button className={`cf-tab ${activeTab === "inventory" ? "is-active" : ""}`} onClick={() => setActiveTab("inventory")}>
            Inventory Consumption
          </button>
          <button className={`cf-tab ${activeTab === "feedback" ? "is-active" : ""}`} onClick={() => setActiveTab("feedback")}>
            Customer Feedback
          </button>
          <button className={`cf-tab ${activeTab === "customers" ? "is-active" : ""}`} onClick={() => setActiveTab("customers")}>
            Customer Analytics
          </button>
          <button className={`cf-tab ${activeTab === "recipes" ? "is-active" : ""}`} onClick={() => setActiveTab("recipes")}>
            Recipe Analytics
          </button>
        </div>

        {activeTab === "date" ? (
          <div className="cf-table-wrap">
            {renderPeriodControls()}
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Bills</th>
                  <th>Sales</th>
                  <th>Tax Collected</th>
                  <th>Net Revenue</th>
                </tr>
              </thead>
              <tbody>
                {dateRows.length ? (
                  <>
                    {dateRows.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td className="cf-table__mono">{row.bills}</td>
                        <td className="cf-table__mono">{formatCurrency(row.sales, settings.currency)}</td>
                        <td className="cf-table__mono">{formatCurrency(row.tax, settings.currency)}</td>
                        <td className="cf-table__mono">{formatCurrency(row.net, settings.currency)}</td>
                      </tr>
                    ))}
                    {dateRows.length > 1 ? (
                      <tr style={{ background: "#fafafa" }}>
                        <td style={{ fontWeight: 700 }}>Total</td>
                        <td className="cf-table__mono" style={{ fontWeight: 700 }}>
                          {dateRows.reduce((sum, row) => sum + row.bills, 0)}
                        </td>
                        <td className="cf-table__mono" style={{ fontWeight: 700 }}>
                          {formatCurrency(dateRows.reduce((sum, row) => sum + row.sales, 0), settings.currency)}
                        </td>
                        <td className="cf-table__mono" style={{ fontWeight: 700 }}>
                          {formatCurrency(dateRows.reduce((sum, row) => sum + row.tax, 0), settings.currency)}
                        </td>
                        <td className="cf-table__mono" style={{ fontWeight: 700 }}>
                          {formatCurrency(dateRows.reduce((sum, row) => sum + row.net, 0), settings.currency)}
                        </td>
                      </tr>
                    ) : null}
                  </>
                ) : (
                  <tr>
                    <td colSpan="5" style={{ color: "var(--cf-text-3)" }}>
                      No sales data for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === "product" ? (
          <div className="cf-table-wrap">
            {renderPeriodControls()}
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Qty Sold</th>
                  <th>Revenue</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {productRows.length ? (
                  productRows.map((row) => {
                    const share = productTotal ? Math.round((row.rev / productTotal) * 100) : 0;
                    return (
                      <tr key={row.name}>
                        <td>{row.name}</td>
                        <td>{row.cat}</td>
                        <td className="cf-table__mono">{row.qty}</td>
                        <td className="cf-table__mono">{formatCurrency(row.rev, settings.currency)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ background: "var(--cf-border)", flex: 1, height: 4 }}>
                              <div style={{ background: "var(--cf-blue)", height: "100%", width: `${share}%` }} />
                            </div>
                            <span className="cf-table__mono" style={{ color: "var(--cf-text-2)", fontSize: 11, minWidth: 30 }}>
                              {share}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="5" style={{ color: "var(--cf-text-3)" }}>
                      No product performance data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === "inventory" ? (
          <div className="cf-table-wrap">
            <div className="cf-table-toolbar">
              <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                Based on the last 30 days of logged inventory movements. Items without movement or risk signals are hidden here.
              </span>
            </div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Stock</th>
                  <th>Daily Use</th>
                  <th>Days Left</th>
                  <th>Expiry</th>
                  <th>Wastage (30d)</th>
                  <th>Pilferage (30d)</th>
                </tr>
              </thead>
              <tbody>
                {inventoryRows.length ? (
                  inventoryRows.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td className="cf-table__mono">{item.current_stock} {item.unit}</td>
                      <td className="cf-table__mono">{item.avg_daily_consumption || 0} {item.unit}</td>
                      <td className="cf-table__mono">{item.days_remaining ?? "-"}</td>
                      <td className="cf-table__mono">{item.expiry_date ? item.expiry_date.slice(0, 10) : "-"}</td>
                      <td className="cf-table__mono">{item.wastage_last_30_days || 0}</td>
                      <td className="cf-table__mono">{item.pilferage_last_30_days || 0}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" style={{ color: "var(--cf-text-3)" }}>
                      No movement-backed inventory consumption data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === "feedback" ? (
          <div className="cf-table-wrap">
            <div className="cf-metrics" style={{ marginBottom: 20 }}>
              <button className="cf-metric cf-metric--button" onClick={() => setFeedbackView("responses")} type="button">
                <div className="cf-metric__label">Responses</div>
                <div className="cf-metric__value">{feedbackSummary.responses}</div>
                <div className="cf-metric__sub">Collected from QR, SMS, and dine-in</div>
              </button>
              <button className="cf-metric cf-metric--button" onClick={() => setFeedbackView("rating")} type="button">
                <div className="cf-metric__label">Average Rating</div>
                <div className="cf-metric__value">{feedbackSummary.average_rating}</div>
                <div className="cf-metric__sub">Out of 5 stars</div>
              </button>
              <button className="cf-metric cf-metric--button" onClick={() => setFeedbackView("fiveStar")} type="button">
                <div className="cf-metric__label">Five Star</div>
                <div className="cf-metric__value">{feedbackSummary.five_star}</div>
                <div className="cf-metric__sub">Strong positive feedback</div>
              </button>
            </div>
            <div className="cf-table-toolbar">
              <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                {feedbackView === "fiveStar"
                  ? "Showing only five-star feedback."
                  : feedbackView === "rating"
                    ? "Showing feedback sorted by rating."
                    : "Showing all collected feedback responses."}
              </span>
            </div>
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Rating</th>
                  <th>Channel</th>
                  <th>Outlet</th>
                  <th>Comment</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {feedbackRows.length ? (
                  feedbackRows.map((item) => (
                    <tr key={item.id}>
                      <td className="cf-table__mono">{item.bill_id}</td>
                      <td className="cf-table__mono">{item.rating}/5</td>
                      <td>{item.channel}</td>
                      <td>{item.outlet_name || "-"}</td>
                      <td>{item.comment || "-"}</td>
                      <td>{new Date(item.created_at).toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6" style={{ color: "var(--cf-text-3)" }}>
                      No customer feedback collected yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : activeTab === "customers" ? (
          <div style={{ display: "grid", gap: 20 }}>
            <div className="cf-metrics">
              <button className="cf-metric cf-metric--button" onClick={() => setCustomerView("tracked")} type="button">
                <div className="cf-metric__label">Tracked Customers</div>
                <div className="cf-metric__value">{customerSummary.total_customers || 0}</div>
                <div className="cf-metric__sub">Customers with a name or phone profile</div>
              </button>
              <button className="cf-metric cf-metric--button" onClick={() => setCustomerView("repeat")} type="button">
                <div className="cf-metric__label">Repeat Customers</div>
                <div className="cf-metric__value">{customerSummary.repeat_customers || 0}</div>
                <div className="cf-metric__sub">Returning guests worth nurturing</div>
              </button>
              <button className="cf-metric cf-metric--button" onClick={() => setCustomerView("loyalty")} type="button">
                <div className="cf-metric__label">Loyalty Points</div>
                <div className="cf-metric__value">{customerSummary.loyalty_points_issued || 0}</div>
                <div className="cf-metric__sub">Ready for CRM reward campaigns</div>
              </button>
              <button className="cf-metric cf-metric--button" onClick={() => setCustomerView("value")} type="button">
                <div className="cf-metric__label">Avg Customer Value</div>
                <div className="cf-metric__value">{formatCurrency(customerSummary.average_customer_value || 0, settings.currency)}</div>
                <div className="cf-metric__sub">
                  Avg feedback: {customerSummary.average_feedback || 0}/5
                </div>
              </button>
            </div>
            <div className="cf-table-toolbar">
              <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                {customerView === "repeat"
                  ? "Showing repeat customers."
                  : customerView === "loyalty"
                    ? "Showing customers sorted by loyalty points."
                    : customerView === "value"
                      ? "Showing highest-value customers first."
                      : "Showing all tracked customer profiles."}
              </span>
            </div>

            <div className="cf-grid-2">
              <div className="cf-table-wrap">
                <div className="cf-section-title">CRM Customer Preferences</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Visits</th>
                      <th>Spend</th>
                      <th>Loyalty</th>
                      <th>Favourite</th>
                      <th>Channel</th>
                      <th>Segment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerRows.length ? (
                      customerRows.slice(0, 12).map((customer) => (
                        <tr key={customer.customer_key}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{customer.customer_name || "Unnamed Customer"}</div>
                            <div style={{ color: "var(--cf-text-3)", fontSize: 11 }}>{customer.customer_phone || "No phone captured"}</div>
                          </td>
                          <td className="cf-table__mono">{customer.visits}</td>
                          <td className="cf-table__mono">{formatCurrency(customer.total_spent, settings.currency)}</td>
                          <td className="cf-table__mono">{customer.loyalty_points}</td>
                          <td>
                            <div>{customer.favorite_item}</div>
                            <div style={{ color: "var(--cf-text-3)", fontSize: 11 }}>{customer.favorite_category}</div>
                          </td>
                          <td>{customer.preferred_channel}</td>
                          <td>
                            <span className={segmentBadgeClass(customer.segment)}>{customer.segment}</span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" style={{ color: "var(--cf-text-3)" }}>
                          Start capturing customer names or phone numbers in bills to build CRM analytics.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="cf-table-wrap">
                <div className="cf-section-title">Campaign Ideas</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Segment</th>
                      <th>Favourite Item</th>
                      <th>Suggested Offer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignSuggestions.length ? (
                      campaignSuggestions.map((suggestion, index) => (
                        <tr key={`${suggestion.customer_name}-${index}`}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{suggestion.customer_name}</div>
                            <div style={{ color: "var(--cf-text-3)", fontSize: 11 }}>{suggestion.customer_phone || "No phone captured"}</div>
                          </td>
                          <td>
                            <span className={segmentBadgeClass(suggestion.segment)}>{suggestion.segment}</span>
                          </td>
                          <td>{suggestion.favorite_item}</td>
                          <td>{suggestion.offer}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4" style={{ color: "var(--cf-text-3)" }}>
                          Campaign suggestions will appear once customer billing data is available.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="cf-table-wrap">
              <div className="cf-section-title">Item-Wise Sales: In-House vs Online</div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>In-House Qty</th>
                    <th>In-House Revenue</th>
                    <th>Online Qty</th>
                    <th>Online Revenue</th>
                    <th>Total Qty</th>
                    <th>Total Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {itemSalesByChannel.length ? (
                    itemSalesByChannel.map((item) => (
                      <tr key={item.item_name}>
                        <td>{item.item_name}</td>
                        <td>{item.category}</td>
                        <td className="cf-table__mono">{item.inhouse_qty}</td>
                        <td className="cf-table__mono">{formatCurrency(item.inhouse_revenue, settings.currency)}</td>
                        <td className="cf-table__mono">{item.online_qty}</td>
                        <td className="cf-table__mono">{formatCurrency(item.online_revenue, settings.currency)}</td>
                        <td className="cf-table__mono">{item.total_qty}</td>
                        <td className="cf-table__mono">{formatCurrency(item.total_revenue, settings.currency)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" style={{ color: "var(--cf-text-3)" }}>
                        No item-wise customer preference data is available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 20 }}>
            <div className="cf-metrics">
              <button className="cf-metric cf-metric--button" onClick={() => setRecipeView("with")} type="button">
                <div className="cf-metric__label">Products With Recipes</div>
                <div className="cf-metric__value">{recipeAnalytics.productsWithRecipes}</div>
                <div className="cf-metric__sub">Base, variation, or add-on recipe coverage</div>
              </button>
              <button className="cf-metric cf-metric--button" onClick={() => setRecipeView("without")} type="button">
                <div className="cf-metric__label">Products Missing Recipes</div>
                <div className="cf-metric__value">{recipeAnalytics.productsWithoutRecipes}</div>
                <div className="cf-metric__sub">Still using manual or fallback costing</div>
              </button>
              <button className="cf-metric cf-metric--button" onClick={() => setRecipeView("blocked")} type="button">
                <div className="cf-metric__label">Blocked By Stock</div>
                <div className="cf-metric__value">{recipeAnalytics.blockedProducts.length}</div>
                <div className="cf-metric__sub">Base recipe cannot be served once from current stock</div>
              </button>
            </div>
            <div className="cf-table-toolbar">
              <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>
                {recipeView === "without"
                  ? "Showing products that still need recipe setup."
                  : recipeView === "blocked"
                    ? "Showing products blocked by current ingredient stock."
                    : "Showing recipe-cost and ingredient-demand details."}
              </span>
            </div>

            {recipeView === "with" ? (
              <div className="cf-grid-2">
              <div className="cf-table-wrap">
                <div className="cf-section-title">Recipe Cost and Margin</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Recipe Cost</th>
                      <th>Sell Price</th>
                      <th>Gross Margin</th>
                      <th>Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeAnalytics.recipeProducts.length ? (
                      recipeAnalytics.recipeProducts.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{product.name}</div>
                            <div style={{ color: "var(--cf-text-3)", fontSize: 11 }}>{product.category || "Other"}</div>
                          </td>
                          <td className="cf-table__mono">{formatCurrency(product.auto_recipe_cost, settings.currency)}</td>
                          <td className="cf-table__mono">{formatCurrency(product.price, settings.currency)}</td>
                          <td className="cf-table__mono">{formatCurrency(product.gross_margin, settings.currency)}</td>
                          <td className="cf-table__mono">{product.base_lines} base · {product.variation_lines} variation · {product.addon_lines} add-on</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No recipe-enabled products yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="cf-table-wrap">
                <div className="cf-section-title">Ingredient Demand from Billed Recipes</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Used Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeAnalytics.ingredientDemand.length ? (
                      recipeAnalytics.ingredientDemand.map((item) => (
                        <tr key={item.ingredient_name}>
                          <td>{item.ingredient_name}</td>
                          <td className="cf-table__mono">{item.quantity.toFixed(3)} {item.unit}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="2" style={{ color: "var(--cf-text-3)" }}>No recipe-backed bill demand yet for this period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              </div>
            ) : null}

            {recipeView === "without" ? (
              <div className="cf-table-wrap">
                <div className="cf-section-title">Products Missing Recipes</div>
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipeAnalytics.missingRecipeProducts.length ? (
                      recipeAnalytics.missingRecipeProducts.map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td>{product.category || "Other"}</td>
                          <td>Recipe not configured</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="3" style={{ color: "var(--cf-text-3)" }}>All visible products have recipe coverage.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}

            {recipeView === "blocked" ? (
            <div className="cf-table-wrap">
              <div className="cf-section-title">Products Blocked By Ingredient Stock</div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {recipeAnalytics.blockedProducts.length ? (
                    recipeAnalytics.blockedProducts.map((product) => (
                      <tr key={product.id}>
                        <td>{product.name}</td>
                        <td>{product.category || "Other"}</td>
                        <td>Current inventory cannot cover one base recipe</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" style={{ color: "var(--cf-text-3)" }}>No products are blocked by ingredient stock right now.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            ) : null}
          </div>
        )}
      </div>
    </Layout>
  );
};
