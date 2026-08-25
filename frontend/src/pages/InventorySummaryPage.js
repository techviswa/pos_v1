import React, { useMemo, useState } from "react";
import axios from "axios";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { useAutoRefresh } from "../hooks/useAutoRefresh";

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

const PAGE_META = {
  items: {
    title: "Inventory Items",
    description: "All inventory records currently tracked in the software.",
  },
  "at-risk": {
    title: "At Risk",
    description: "Items likely to run out soon or already below reorder level.",
  },
  expiry: {
    title: "Expiry Alerts",
    description: "Items nearing expiry and needing quick action.",
  },
  losses: {
    title: "Losses",
    description: "Items with wastage or pilferage recorded in the last 30 days.",
  },
};

export const InventorySummaryPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { summary } = useParams();
  const seededState = location.state || {};
  const [loading, setLoading] = useState(!seededState.inventory && !seededState.snapshot);
  const [inventory, setInventory] = useState(seededState.inventory || []);
  const [snapshot, setSnapshot] = useState(
    seededState.snapshot || {
      atRisk: [],
      expiryAlerts: [],
      totalWastage: 0,
      totalPilferage: 0,
      totalItems: 0,
    }
  );

  const navigateToSummary = (summaryKey) => {
    navigate(`/inventory/summary/${summaryKey}`, {
      replace: true,
      state: {
        inventory,
        snapshot,
      },
    });
  };

  const fetchData = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/inventory`, { withCredentials: true });
      const items = response.data.items || [];
      setInventory(items);
      setSnapshot({
        atRisk: response.data.at_risk_items || [],
        expiryAlerts: response.data.expiry_alerts || [],
        totalWastage: response.data.total_wastage_last_30_days || 0,
        totalPilferage: response.data.total_pilferage_last_30_days || 0,
        totalItems: response.data.total_inventory_items || items.length,
      });
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchData, { enabled: !seededState.inventory && !seededState.snapshot });

  const meta = PAGE_META[summary] || PAGE_META.items;

  const cards = useMemo(() => [
    { key: "items", label: "Inventory Items", value: `${snapshot.totalItems || 0}`, sub: "Tracked ingredient records" },
    { key: "at-risk", label: "At Risk", value: `${snapshot.atRisk.length || 0}`, sub: "Likely to run out within 7 days" },
    { key: "expiry", label: "Expiry Alerts", value: `${snapshot.expiryAlerts.length || 0}`, sub: "Items expiring within 14 days" },
    { key: "losses", label: "Losses", value: `${(snapshot.totalWastage || 0) + (snapshot.totalPilferage || 0)}`, sub: `Wastage ${snapshot.totalWastage || 0} · Pilferage ${snapshot.totalPilferage || 0}` },
  ], [snapshot]);

  const filteredRows = useMemo(() => {
    if (summary === "at-risk") {
      return snapshot.atRisk;
    }
    if (summary === "expiry") {
      return snapshot.expiryAlerts;
    }
    if (summary === "losses") {
      return inventory
        .filter((item) => (item.wastage_last_30_days || 0) > 0 || (item.pilferage_last_30_days || 0) > 0)
        .sort((left, right) => {
          const leftLoss = Number(left.wastage_last_30_days || 0) + Number(left.pilferage_last_30_days || 0);
          const rightLoss = Number(right.wastage_last_30_days || 0) + Number(right.pilferage_last_30_days || 0);
          return rightLoss - leftLoss;
        });
    }
    return inventory;
  }, [inventory, snapshot, summary]);

  if (loading) {
    return (
      <Layout title={meta.title}>
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading inventory summary...</p>
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
            <button className="cf-btn cf-btn--secondary" onClick={() => navigate("/inventory")} type="button">
              Back to Inventory
            </button>
          </div>
        </div>

        <div className="cf-metrics">
          {cards.map((card) => (
            <button
              className={`cf-metric cf-metric--button ${summary === card.key ? "is-active" : ""}`}
              key={card.key}
              onClick={() => navigateToSummary(card.key)}
              type="button"
            >
              <div className="cf-metric__label">{card.label}</div>
              <div className="cf-metric__value">{card.value}</div>
              <div className="cf-metric__sub">{card.sub}</div>
            </button>
          ))}
        </div>

        <div className="cf-table-wrap" style={{ marginTop: 24 }}>
          <div className="cf-section-title">{meta.title} Details</div>
          <table className="cf-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Stock</th>
                <th>Daily Use</th>
                <th>Days Left</th>
                <th>Expiry</th>
                <th>Wastage</th>
                <th>Pilferage</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((item) => (
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
                    No inventory records found for this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
};

