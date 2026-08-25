import React, { useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { formatCurrency } from "../lib/pos";
import { useUi } from "../contexts/UiContext";
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
  "team-members": {
    title: "Team Members",
    description: "All staff accounts configured in the software.",
  },
  "active-users": {
    title: "Active Users",
    description: "Staff members who can currently sign in and operate.",
  },
  "tracked-sales": {
    title: "Tracked Sales",
    description: "Sales performance attributed to logged-in staff.",
  },
  "outlet-linked": {
    title: "Outlet-linked Staff",
    description: "Staff members mapped to one or more outlets.",
  },
};

export const StaffSummaryPage = () => {
  const { settings } = useUi();
  const navigate = useNavigate();
  const { summary } = useParams();
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState([]);

  const fetchData = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/staff`, { withCredentials: true });
      setStaff(response.data || []);
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchData);

  const meta = PAGE_META[summary] || PAGE_META["team-members"];

  const cards = useMemo(() => [
    { label: "Team Members", value: `${staff.length}`, sub: "Configured with custom rights" },
    { label: "Active Users", value: `${staff.filter((item) => item.active).length}`, sub: "Can sign in and operate" },
    { label: "Tracked Sales", value: formatCurrency(staff.reduce((sum, item) => sum + Number(item.performance?.total_sales || 0), 0), settings.currency), sub: "Attributed to logged-in staff" },
    { label: "Outlet-linked Staff", value: `${staff.filter((item) => (item.assigned_outlet_ids || []).length).length}`, sub: "Mapped to outlet-wise rights" },
  ], [settings.currency, staff]);

  const filteredStaff = useMemo(() => {
    if (summary === "active-users") {
      return staff.filter((item) => item.active);
    }
    if (summary === "outlet-linked") {
      return staff.filter((item) => (item.assigned_outlet_ids || []).length);
    }
    if (summary === "tracked-sales") {
      return [...staff].sort((a, b) => Number(b.performance?.total_sales || 0) - Number(a.performance?.total_sales || 0));
    }
    return staff;
  }, [staff, summary]);

  if (loading) {
    return (
      <Layout title={meta.title}>
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading staff summary...</p>
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
            <button className="cf-btn cf-btn--secondary" onClick={() => navigate("/staff")} type="button">
              Back to Staff
            </button>
          </div>
        </div>

        <div className="cf-metrics">
          {cards.map((card) => (
            <button
              className={`cf-metric cf-metric--button ${PAGE_META[summary]?.title === card.label ? "is-active" : ""}`}
              key={card.label}
              onClick={() => navigate(`/staff/summary/${card.label.toLowerCase().replace(" ", "-")}`)}
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
                <th>Name</th>
                <th>Role</th>
                <th>Outlets</th>
                <th>Sales</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStaff.length ? (
                filteredStaff.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{member.name}</div>
                      <div style={{ color: "var(--cf-text-3)", fontSize: 12 }}>{member.email}</div>
                    </td>
                    <td>{member.role}</td>
                    <td>{(member.assigned_outlets || []).map((outlet) => outlet.name).join(", ") || "No outlet assigned"}</td>
                    <td className="cf-table__mono">{formatCurrency(member.performance?.total_sales || 0, settings.currency)}</td>
                    <td>{member.active ? "Active" : "Inactive"}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => navigate(`/staff/${member.id}/bio`)} type="button">
                        View Bio
                      </button>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => navigate(`/staff/${member.id}/activity`)} type="button">
                        Track Activity
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ color: "var(--cf-text-3)" }}>No staff records found for this view.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
};

