import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Layout } from "../components/Layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { formatCurrency } from "../lib/pos";
import { useAuth } from "../contexts/AuthContext";
import { useUi } from "../contexts/UiContext";
import { getTrackingLine } from "../core/billing/utils/orderTracking";
import { OutletOverviewPanel } from "../core/outlets/components/OutletOverviewPanel";
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

const getStartOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const isFromTodayOrYesterday = (dateInput) => {
  const createdAt = new Date(dateInput);
  if (Number.isNaN(createdAt.getTime())) {
    return false;
  }

  const startOfToday = getStartOfToday();
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  return createdAt >= startOfYesterday;
};

export const Bills = () => {
  const { user } = useAuth();
  const { settings } = useUi();
  const { selectedOutlet, selectedOutletId } = useActiveOutlet();
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [filters, setFilters] = useState({ num: "", date: "", min: "", max: "", pay: "" });
  const [selectedBill, setSelectedBill] = useState(null);

  const fetchBills = async () => {
    if (!selectedOutletId) {
      setBills([]);
      setLoading(false);
      return;
    }

    const response = await axios.get(`${API_URL}/api/bills`, {
      withCredentials: true,
      params: {
        outlet_id: selectedOutletId,
        limit: 100,
      },
    });
    setBills(response.data);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void fetchBills();
    // We only want to react to outlet changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutletId]);

  const visibleBills = useMemo(() => {
    if (user?.role === "Waiter") {
      return bills.filter((bill) => bill.created_by === user.id && isFromTodayOrYesterday(bill.created_at));
    }
    return bills;
  }, [bills, user]);

  const filtered = useMemo(() => {
    return visibleBills.filter((bill) => {
      const billDate = new Date(bill.created_at).toISOString().slice(0, 10);
      const matchesNum = !filters.num || bill.id.toLowerCase().includes(filters.num.toLowerCase());
      const matchesDate = !filters.date || billDate === filters.date;
      const matchesMin = !filters.min || bill.total >= Number(filters.min);
      const matchesMax = !filters.max || bill.total <= Number(filters.max);
      const matchesPay = !filters.pay || bill.payment_type === filters.pay;
      return matchesNum && matchesDate && matchesMin && matchesMax && matchesPay;
    });
  }, [visibleBills, filters]);

  if (loading) {
    return (
      <Layout title="Bills">
        <div className="cf-loading">
          <div className="cf-loading__inner">
            <div className="cf-loading__spinner" />
            <p>Loading bills...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!selectedOutletId) {
    return (
      <Layout title="Bills">
        <div className="cf-page">
          <OutletOverviewPanel
            description="Bills are now outlet-specific. Select an outlet to review only that outlet's billing history."
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={selectedOutlet ? `Bills · ${selectedOutlet.name}` : "Bills"}>
      <div className="cf-page" data-testid="bills-page">
        <div className="cf-page__header">
          <div>
            <h1>Bills</h1>
            <p>
              {user?.role === "Waiter"
                ? "Bills generated from your waiter account for today and yesterday"
                : "All generated bills"}
            </p>
          </div>
        </div>

        <div className="cf-table-wrap">
          <div className="cf-table-toolbar">
            <input className="cf-search" onChange={(event) => setFilters({ ...filters, num: event.target.value })} placeholder="Bill #..." style={{ width: 110 }} value={filters.num} />
            <input className="cf-search" onChange={(event) => setFilters({ ...filters, date: event.target.value })} style={{ width: 145 }} type="date" value={filters.date} />
            <input className="cf-search" onChange={(event) => setFilters({ ...filters, min: event.target.value })} placeholder="Min" style={{ width: 90 }} type="number" value={filters.min} />
            <input className="cf-search" onChange={(event) => setFilters({ ...filters, max: event.target.value })} placeholder="Max" style={{ width: 90 }} type="number" value={filters.max} />
            <select className="cf-select" onChange={(event) => setFilters({ ...filters, pay: event.target.value })} style={{ width: 160 }} value={filters.pay}>
              <option value="">All Payment</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
            </select>
            <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>{filtered.length} bills</span>
          </div>

          <table className="cf-table">
            <thead>
              <tr>
                <th>Bill #</th>
                <th>Date</th>
                <th>Time</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Tax</th>
                <th>Payment</th>
                <th>Order</th>
                <th>Cashier</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((bill) => {
                const created = new Date(bill.created_at);
                const tax = bill.tax || 0;
                return (
                  <tr key={bill.id} data-testid={`bill-row-${bill.id}`}>
                    <td className="cf-table__mono" style={{ fontWeight: 600 }}>
                      {bill.id}
                    </td>
                    <td className="cf-table__mono">{created.toISOString().slice(0, 10)}</td>
                    <td className="cf-table__mono" style={{ color: "var(--cf-text-2)" }}>
                      {created.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td>{bill.items.length} items</td>
                    <td className="cf-table__mono" style={{ fontWeight: 600 }}>
                      {formatCurrency(bill.total, settings.currency)}
                    </td>
                    <td className="cf-table__mono" style={{ color: "var(--cf-text-2)" }}>
                      {formatCurrency(tax, settings.currency)}
                    </td>
                    <td>{bill.payment_type}</td>
                    <td style={{ color: "var(--cf-text-2)" }}>{getTrackingLine(bill)}</td>
                    <td style={{ color: "var(--cf-text-2)" }}>{bill.created_by_name || bill.created_by_role || "Owner"}</td>
                    <td>
                      <button className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => setSelectedBill(bill)}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Dialog onOpenChange={() => setSelectedBill(null)} open={Boolean(selectedBill)}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Bill Details</DialogTitle>
            </DialogHeader>
            {selectedBill ? (
              <div style={{ display: "grid", gap: 16 }}>
                <div className="cf-grid-2">
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Bill #</div>
                    <div className="cf-table__mono">{selectedBill.id}</div>
                  </div>
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Payment</div>
                    <div>{selectedBill.payment_type}</div>
                  </div>
                </div>
                <div className="cf-grid-2">
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Billed By</div>
                    <div>{selectedBill.created_by_name || selectedBill.created_by_role || "Owner"}</div>
                  </div>
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Role</div>
                    <div>{selectedBill.created_by_role || "-"}</div>
                  </div>
                </div>
                {(Number(selectedBill.discount_amount || 0) > 0 || selectedBill.printable_offer_title || selectedBill.printable_offer_message) ? (
                  <div className="cf-grid-2">
                    <div>
                      <div className="cf-page__overline" style={{ marginBottom: 6 }}>Discount</div>
                      <div>
                        {Number(selectedBill.discount_amount || 0) > 0
                          ? `${selectedBill.discount_label || "Discount"} (-${formatCurrency(selectedBill.discount_amount, settings.currency)})`
                          : "No discount"}
                      </div>
                    </div>
                    <div>
                      <div className="cf-page__overline" style={{ marginBottom: 6 }}>Printed Offer</div>
                      <div style={{ color: "var(--cf-text-2)", fontSize: 13 }}>
                        {selectedBill.printable_offer_title || selectedBill.printable_offer_message
                          ? [selectedBill.printable_offer_title, selectedBill.printable_offer_message].filter(Boolean).join(" - ")
                          : "No printed offer"}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="cf-page__overline" style={{ marginBottom: 6 }}>Feedback</div>
                  <div style={{ color: "var(--cf-text-2)", fontSize: 13 }}>
                    {selectedBill.feedback_rating ? `Rated ${selectedBill.feedback_rating}/5 via ${selectedBill.feedback_channel || "feedback link"}` : "No feedback yet"}
                  </div>
                  {selectedBill.feedback_token ? (
                    <div className="cf-table__mono" style={{ marginTop: 8, wordBreak: "break-all" }}>
                      {`${window.location.origin}/feedback/${selectedBill.feedback_token}`}
                    </div>
                  ) : null}
                </div>
                <div>
                  <div className="cf-page__overline" style={{ marginBottom: 6 }}>Order Tracking</div>
                  <div style={{ color: "var(--cf-text-2)", fontSize: 13 }}>{getTrackingLine(selectedBill)}</div>
                  <div style={{ color: "var(--cf-text-2)", fontSize: 13, marginTop: 6 }}>
                    {selectedBill.customer_name || "Walk-in"}{selectedBill.customer_phone ? ` · ${selectedBill.customer_phone}` : ""}
                  </div>
                  {selectedBill.notes ? (
                    <div style={{ color: "var(--cf-text-2)", fontSize: 13, marginTop: 6 }}>
                      Notes: {selectedBill.notes}
                    </div>
                  ) : null}
                </div>
                <div className="cf-table-wrap">
                  <table className="cf-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qty</th>
                        <th>Price</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBill.items.map((item, index) => (
                        <tr key={`${item.id}-${index}`}>
                          <td>{item.name}</td>
                          <td className="cf-table__mono">{item.quantity}</td>
                          <td className="cf-table__mono">{formatCurrency(item.price, settings.currency)}</td>
                          <td className="cf-table__mono">{formatCurrency(item.quantity * item.price, settings.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

