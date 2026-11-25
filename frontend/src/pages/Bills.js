import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from 'react-router-dom';
import { API_URL } from "../lib/apiUrl";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import axios from "axios";
import { Layout } from "../components/Layout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { formatCurrency, hasPermission } from "../lib/pos";
import { apiData } from '../lib/apiData';
import { getApiErrorMessage } from '../lib/apiErrors';
import { useAuth } from "../contexts/AuthContext";
import { useUi } from "../contexts/UiContext";
import { getTrackingLine } from "../core/billing/utils/orderTracking";
import { OutletOverviewPanel } from "../core/outlets/components/OutletOverviewPanel";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { StockReversal } from "../core/billing/components/StockReversal";
import { BillPayments } from "../core/billing/components/BillPayments";
import { printReceipt } from "../core/billing/receipt/printReceipt";
import { toast } from "sonner";


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
  const navigate = useNavigate();
  const { settings } = useUi();
  const { selectedOutlet, selectedOutletId } = useActiveOutlet();
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState(null);
  const [page, setPage] = useState(1), [error, setError] = useState('');
  const [filters, setFilters] = useState({ num: "", date: "", min: "", max: "", pay: "" });
  const [selectedBill, setSelectedBill] = useState(null);
  const reusableItems = selectedBill?.items?.length && selectedBill.items.every(item =>
    !Object.prototype.hasOwnProperty.call(item, 'productId') || item.productId || item.product_id);
  useEffect(() => setSelectedBill(null), [selectedOutletId, user?.id]);
  const scopeKey = JSON.stringify([selectedOutletId, user?.id, user?.role, page, filters]);
  const scope = useRef(scopeKey), sequence = useRef(0);
  scope.current = scopeKey;
  const bills = useMemo(() => snapshot?.scope === scopeKey ? snapshot.items : [], [snapshot, scopeKey]);
  const hasMore = snapshot?.scope === scopeKey && snapshot.has_more;
  const changeFilter = changes => { setFilters(current => ({ ...current, ...changes })); setPage(1); setSelectedBill(null); };

  const fetchBills = useCallback(async () => {
    if (!selectedOutletId) {
      setLoading(false);
      return;
    }
    const key = scopeKey, request = ++sequence.current;
    setLoading(true); setError('');
    try {
    const response = await axios.get(`${API_URL}/api/billing`, {
      withCredentials: true,
      skipCache: true,
      params: {
        outlet_id: selectedOutletId, paged: true, page,
        search: filters.num || undefined, date: filters.date || undefined,
        min: filters.min || undefined, max: filters.max || undefined, payment: filters.pay || undefined,
        created_since: user?.role === 'Waiter' ? (() => { const date = getStartOfToday(); date.setDate(date.getDate() - 1); return date.toISOString(); })() : undefined,
      },
    });
    const data = apiData(response);
    if (!Array.isArray(data?.items)) throw new Error('Invalid bill history response');
    if (scope.current === key && sequence.current === request) setSnapshot({ ...data, scope: key });
    } catch (failure) { if (scope.current === key && sequence.current === request) setError(getApiErrorMessage(failure, 'Bill history could not be loaded. Retry.')); }
    finally { if (scope.current === key && sequence.current === request) setLoading(false); }
  }, [selectedOutletId, scopeKey, page, filters, user?.role]);

  // New bills, payments and refunds from other terminals appear without a manual refresh.
  useAutoRefresh(fetchBills, { liveResources: ["bills"], enabled: Boolean(selectedOutletId), refreshKey: scopeKey });

  const visibleBills = useMemo(() => {
    if (user?.role === "Waiter") {
      return bills.filter((bill) => bill.created_by === user.id && isFromTodayOrYesterday(bill.created_at));
    }
    return bills;
  }, [bills, user]);

  const filtered = visibleBills;

  if (selectedOutletId && loading && !snapshot && !error) {
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
            <h1>Bills &amp; history</h1>
            <p>
              {user?.role === "Waiter"
                ? "Bills generated from your waiter account for today and yesterday"
                : "Review recent and older invoices, payments and receipts"}
            </p>
          </div>
        </div>
        {error && <p role="alert" className="cf-card cf-card--padded">{error} <button className="cf-btn cf-btn--secondary" onClick={fetchBills}>Retry history</button></p>}
        {loading && <p role="status">Refreshing bill history…</p>}

        <div className="cf-table-wrap">
          <div className="cf-table-toolbar">
            <input className="cf-search" aria-label="Search bill or customer" onChange={(event) => changeFilter({ num: event.target.value })} placeholder="Bill or customer…" value={filters.num} />
            <input className="cf-search" aria-label="Bill date" onChange={(event) => changeFilter({ date: event.target.value })} style={{ width: 145 }} type="date" value={filters.date} />
            <input className="cf-search" aria-label="Minimum bill amount" onChange={(event) => changeFilter({ min: event.target.value })} placeholder="Min" min="0" style={{ width: 90 }} type="number" value={filters.min} />
            <input className="cf-search" aria-label="Maximum bill amount" onChange={(event) => changeFilter({ max: event.target.value })} placeholder="Max" min="0" style={{ width: 90 }} type="number" value={filters.max} />
            <select className="cf-select" aria-label="Bill payment method" onChange={(event) => changeFilter({ pay: event.target.value })} style={{ width: 160 }} value={filters.pay}>
              <option value="">All Payment</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
            </select>
            <span style={{ color: "var(--cf-text-3)", fontSize: 12 }}>Page {page} · {filtered.length} bills</span>
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
                      {bill.invoice_number || bill.id}
                    </td>
                    <td className="cf-table__mono">{Number.isFinite(created.getTime()) ? created.toISOString().slice(0, 10) : 'Not recorded'}</td>
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
              {!filtered.length && !loading && !error && <tr><td colSpan={10}>No bills match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <nav className="cf-billing-panel__actions" aria-label="Bill history pages">
          <button className="cf-btn cf-btn--secondary" disabled={loading || page <= 1} onClick={() => { setPage(value => value - 1); setSelectedBill(null); }}>Previous</button>
          <span>Page {page}</span>
          <button className="cf-btn cf-btn--secondary" disabled={loading || !hasMore} onClick={() => { setPage(value => value + 1); setSelectedBill(null); }}>Next</button>
        </nav>

        <Dialog onOpenChange={() => setSelectedBill(null)} open={Boolean(selectedBill) && bills.some(bill => bill.id === selectedBill.id)}>
          <DialogContent className="bg-white">
            <DialogHeader>
              <DialogTitle className="cf-dialog__title">Bill Details</DialogTitle>
            </DialogHeader>
            {selectedBill ? (
              <div style={{ display: "grid", gap: 16 }}>
                <div className="cf-billing-panel__actions">
                  <button className="cf-btn cf-btn--primary" data-testid="print-bill-receipt" type="button" onClick={() => printReceipt({ bill: selectedBill, settings }).catch(() => toast.error("Could not open the print dialog. Try again."))}>Print receipt</button>
                </div>
                {hasPermission(user, 'billing') && <div>
                  <button className="cf-btn cf-btn--secondary" onClick={() => navigate('/billing', reusableItems ? { state: { repeatBillId: selectedBill.id, repeatOutletId: selectedOutletId } } : {})}>{reusableItems ? 'Use items for a new sale' : 'Start a new sale'}</button>
                  <p className="cf-card__meta">{reusableItems ? 'Current menu prices and availability apply.' : 'These historical items have no menu references. Choose the current products for the new sale.'} The original bill, payments and table reservation remain unchanged.</p>
                </div>}
                <div className="cf-grid-2">
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Invoice</div>
                    <div className="cf-table__mono">{selectedBill.invoice_number || selectedBill.id}</div>
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
                {Number(selectedBill.loyalty_discount || 0) > 0 || Number(selectedBill.loyalty_points_earned || 0) > 0 ? (
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Loyalty</div>
                    <div>
                      {Number(selectedBill.loyalty_discount || 0) > 0 ? `${selectedBill.loyalty_redeem_points} points used (-${formatCurrency(selectedBill.loyalty_discount, settings.currency)}). ` : ""}
                      {Number(selectedBill.loyalty_points_earned || 0) > 0 ? `${selectedBill.loyalty_points_earned} points earned.` : ""}
                    </div>
                  </div>
                ) : null}
                {(selectedBill.payments || []).some((payment) => payment.method === "Gift Card") ? (
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Gift card</div>
                    <div>{(selectedBill.payments || []).filter((payment) => payment.method === "Gift Card").map((payment) => `${payment.reference || "Card"} ${formatCurrency(payment.amount, settings.currency)}`).join(", ")}</div>
                  </div>
                ) : null}
                {Number(selectedBill.tip_amount || 0) > 0 ? (
                  <div>
                    <div className="cf-page__overline" style={{ marginBottom: 6 }}>Tip (not taxed)</div>
                    <div>{formatCurrency(selectedBill.tip_amount, settings.currency)} {selectedBill.tip_staff_name ? `for ${selectedBill.tip_staff_name}` : "to the shared pool"}</div>
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
            {selectedBill ? (
              <BillPayments
                apiUrl={API_URL}
                bill={selectedBill}
                canRefund={["Owner", "Manager"].includes(user?.role)}
                canCollect={hasPermission(user, "billing")}
                canConfirm={["Owner", "Manager"].includes(user?.role)}
                currency={settings.currency}
                key={`payments-${selectedBill.id}`}
                onChanged={(updated) => {
                  if (updated?.id) setSelectedBill(updated);
                  void fetchBills();
                }}
              />
            ) : null}
            {selectedBill && ["Owner", "Manager"].includes(user?.role) && <StockReversal key={selectedBill.id} bill={selectedBill} apiUrl={API_URL} />}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

