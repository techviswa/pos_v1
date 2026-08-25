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

export const StaffDetailPage = () => {
  const { settings } = useUi();
  const navigate = useNavigate();
  const { staffId, section } = useParams();
  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState(null);
  const [activityData, setActivityData] = useState(null);
  const [staff, setStaff] = useState([]);

  const fetchData = async () => {
    try {
      const [staffResponse, activityResponse] = await Promise.all([
        axios.get(`${API_URL}/api/staff`, { withCredentials: true }),
        axios.get(`${API_URL}/api/staff/${staffId}/activity`, { withCredentials: true }),
      ]);
      setStaff(staffResponse.data || []);
      setMember((staffResponse.data || []).find((item) => item.id === staffId) || null);
      setActivityData(activityResponse.data || null);
    } finally {
      setLoading(false);
    }
  };

  useAutoRefresh(fetchData);

  const isBioPage = section === "bio";
  const pageTitle = isBioPage ? "Staff Bio" : "Staff Activity";
  const overviewCards = useMemo(() => [
    { label: "Team Members", value: `${staff.length}`, sub: "Configured with custom rights" },
    { label: "Active Users", value: `${staff.filter((item) => item.active).length}`, sub: "Can sign in and operate" },
    { label: "Tracked Sales", value: formatCurrency(staff.reduce((sum, item) => sum + Number(item.performance?.total_sales || 0), 0), settings.currency), sub: "Attributed to logged-in staff" },
    { label: "Outlet-linked Staff", value: `${staff.filter((item) => (item.assigned_outlet_ids || []).length).length}`, sub: "Mapped to outlet-wise rights" },
  ], [settings.currency, staff]);

  const cards = useMemo(() => {
    if (!member) return [];
    if (isBioPage) {
      return [
        { label: "Employee Code", value: member.bio?.employee_code || "-", sub: member.role || "Staff" },
        { label: "Profile Status", value: member.profile_completed ? "Complete" : "Pending", sub: member.email || "-" },
        { label: "Phone", value: member.phone || "-", sub: member.bio?.emergency_contact_phone || "No emergency contact" },
        { label: "Joined", value: member.bio?.joining_date || "-", sub: member.bio?.shift_timing || "Shift not set" },
      ];
    }
    return [
      { label: "Bills Processed", value: `${activityData?.summary?.bills_processed || 0}`, sub: "Orders handled by this employee" },
      { label: "Sales Total", value: formatCurrency(activityData?.summary?.sales_total || 0, settings.currency), sub: "Revenue attributed to this employee" },
      { label: "Reservations", value: `${activityData?.summary?.reservations_handled || 0}`, sub: "Table actions logged" },
      { label: "Inventory Actions", value: `${activityData?.summary?.inventory_actions || 0}`, sub: "Stock-related actions tracked" },
    ];
  }, [activityData, isBioPage, member, settings.currency]);

  if (loading) {
    return (
      <Layout title={pageTitle}>
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading staff details...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!member) {
    return (
      <Layout title={pageTitle}>
        <div className="cf-page">
          <div className="cf-empty-state">Staff member not found.</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={pageTitle}>
      <div className="cf-page">
        <div className="cf-page__header">
          <div>
            <h1>{member.name}</h1>
            <p>
              {isBioPage
                ? "Complete employee bio and onboarding details."
                : "Full employee activity with recent bills, reservations, and tracked actions."}
            </p>
          </div>
          <div className="cf-page__header-actions" style={{ display: "flex", gap: 10 }}>
            {isBioPage ? (
              <button className="cf-btn cf-btn--secondary" onClick={() => navigate(`/staff/${staffId}/activity`)} type="button">
                Track Activity
              </button>
            ) : (
              <button className="cf-btn cf-btn--secondary" onClick={() => navigate(`/staff/${staffId}/bio`)} type="button">
                View Bio
              </button>
            )}
          </div>
        </div>

        <div className="cf-metrics">
          {overviewCards.map((card) => (
            <div className="cf-metric" key={card.label}>
              <div className="cf-metric__label">{card.label}</div>
              <div className="cf-metric__value">{card.value}</div>
              <div className="cf-metric__sub">{card.sub}</div>
            </div>
          ))}
        </div>

        <div className="cf-metrics" style={{ marginTop: 20 }}>
          {cards.map((card) => (
            <div className="cf-metric" key={card.label}>
              <div className="cf-metric__label">{card.label}</div>
              <div className="cf-metric__value">{card.value}</div>
              <div className="cf-metric__sub">{card.sub}</div>
            </div>
          ))}
        </div>

        {isBioPage ? (
          <>
            <div className="cf-table-wrap" style={{ marginTop: 24 }}>
              <div className="cf-section-title">Identity and Contact</div>
              <table className="cf-table">
                <tbody>
                  <tr><td>Name</td><td>{member.name || "-"}</td></tr>
                  <tr><td>Email</td><td>{member.email || "-"}</td></tr>
                  <tr><td>Phone</td><td>{member.phone || "-"}</td></tr>
                  <tr><td>Role</td><td>{member.role || "-"}</td></tr>
                  <tr><td>Assigned Outlets</td><td>{(member.assigned_outlets || []).map((outlet) => outlet.name).join(", ") || "No outlet assigned"}</td></tr>
                </tbody>
              </table>
            </div>

            <div className="cf-table-wrap" style={{ marginTop: 24 }}>
              <div className="cf-section-title">Complete Bio</div>
              <table className="cf-table">
                <tbody>
                  <tr><td>Date of Birth</td><td>{member.bio?.date_of_birth || "-"}</td></tr>
                  <tr><td>Gender</td><td>{member.bio?.gender || "-"}</td></tr>
                  <tr><td>Address</td><td>{member.bio?.address || "-"}</td></tr>
                  <tr><td>Emergency Contact</td><td>{member.bio?.emergency_contact_name || "-"} {member.bio?.emergency_contact_phone ? `· ${member.bio.emergency_contact_phone}` : ""}</td></tr>
                  <tr><td>Education</td><td>{member.bio?.education || "-"}</td></tr>
                  <tr><td>ID Number</td><td>{member.bio?.id_number || "-"}</td></tr>
                  <tr><td>Shift Timing</td><td>{member.bio?.shift_timing || "-"}</td></tr>
                  <tr><td>Notes</td><td>{member.bio?.notes || "-"}</td></tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="cf-table-wrap" style={{ marginTop: 24 }}>
              <div className="cf-section-title">Recent Activity</div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Activity</th>
                    <th>Details</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(activityData?.recent_activity || []).length ? (
                    activityData.recent_activity.map((item, index) => (
                      <tr key={`${item.type}-${index}`}>
                        <td style={{ textTransform: "capitalize" }}>{item.type}</td>
                        <td>{item.label}</td>
                        <td>{item.meta || "-"}</td>
                        <td>{item.created_at ? new Date(item.created_at).toLocaleString("en-IN") : "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan="4" style={{ color: "var(--cf-text-3)" }}>No tracked activity yet for this employee.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="cf-table-wrap" style={{ marginTop: 24 }}>
              <div className="cf-section-title">Recent Bills</div>
              <table className="cf-table">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Customer</th>
                    <th>Order</th>
                    <th>Total</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(activityData?.recent_bills || []).length ? (
                    activityData.recent_bills.map((bill) => (
                      <tr key={bill.id}>
                        <td className="cf-table__mono">{bill.id.slice(0, 8)}</td>
                        <td>{bill.customer_name || "Walk-in"}</td>
                        <td>{bill.order_type || "Dine-In"} {bill.table_label ? `· ${bill.table_label}` : ""}</td>
                        <td className="cf-table__mono">{formatCurrency(bill.total || 0, settings.currency)}</td>
                        <td>{bill.created_at ? new Date(bill.created_at).toLocaleString("en-IN") : "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan="5" style={{ color: "var(--cf-text-3)" }}>No recent bills found for this employee.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

