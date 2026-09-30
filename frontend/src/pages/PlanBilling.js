import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { apiData } from "../lib/apiData";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency } from "../lib/pos";
import { formatDateTime } from "../core/staff/staffTime";

const STATUS_TEXT = {
  trial: "Free trial", trialing: "Free trial", active: "Active", past_due: "Payment overdue (still working while it is retried)",
  expired: "Expired: read-only until paid", cancelled: "Cancelled: read-only", suspended: "Suspended by Taskoora",
};

/** The Owner's Taskoora plan: pay by UPI Autopay or card mandate through Razorpay, see payments, stop auto-pay. */
export const PlanBilling = () => {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [cycle, setCycle] = useState("monthly");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/saas/billing/status`, { withCredentials: true, skipCache: true });
      setData(apiData(response));
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { refreshOnFocus: true });

  const pay = async (planSlug) => {
    setBusy(true);
    try {
      const response = await axios.post(`${API_URL}/api/saas/billing/checkout`, { plan_slug: planSlug, billing_cycle: cycle }, { withCredentials: true });
      const url = apiData(response)?.short_url;
      if (!url || !/^https:\/\//.test(url)) throw new Error("No payment page was returned");
      // Razorpay's hosted page sets up the UPI Autopay / card mandate; the plan switches once Razorpay confirms.
      window.location.assign(url);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not open the payment page"));
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Stop automatic payment? Your plan stays active until the end of the paid period, then becomes read-only.")) return;
    setBusy(true);
    try {
      await axios.post(`${API_URL}/api/saas/billing/cancel`, {}, { withCredentials: true });
      toast.success("Automatic payment will stop at the end of the paid period");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not stop automatic payment"));
    } finally {
      setBusy(false);
    }
  };

  const paidPlans = (data?.plans || []).filter((plan) => Number(plan.pricing?.[cycle] || 0) > 0);

  return (
    <Layout title="Plan & Billing">
      <div className="cf-page" data-testid="plan-billing-page">
        <div className="cf-page__header">
          <div>
            <h1>Plan &amp; Billing</h1>
            <p>Your Taskoora subscription. Payments are taken automatically each period by UPI Autopay or card through Razorpay; your data is never deleted if a payment fails.</p>
          </div>
        </div>
        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}
        {data ? (
          <>
            <div className="cf-metrics">
              <div className="cf-metric"><div className="cf-metric__label">Plan</div><div className="cf-metric__value">{data.plan_slug || "-"}</div><div className="cf-metric__sub">{data.billing_cycle || ""}</div></div>
              <div className="cf-metric"><div className="cf-metric__label">Status</div><div className="cf-metric__value" style={{ fontSize: 16 }}>{STATUS_TEXT[data.status] || data.status || "-"}</div></div>
              <div className="cf-metric"><div className="cf-metric__label">{data.cancel_at_period_end ? "Ends on" : "Paid until"}</div><div className="cf-metric__value" style={{ fontSize: 16 }}>{formatDateTime(data.current_period_end || data.trial_end)}</div></div>
              <div className="cf-metric"><div className="cf-metric__label">Automatic payment</div><div className="cf-metric__value" style={{ fontSize: 16 }}>{data.auto_pay ? (data.cancel_at_period_end ? "Stopping" : "On") : "Off"}</div></div>
            </div>
            {!data.configured ? <p className="cf-card__meta" role="alert">Online plan payments are not switched on yet. Contact Taskoora support to pay.</p> : null}
            {data.pending_checkout?.short_url ? (
              <div className="cf-card cf-card--padded" role="status" style={{ marginTop: 12 }}>
                You started paying for {data.pending_checkout.plan_slug} ({data.pending_checkout.billing_cycle}).{" "}
                <a className="cf-btn cf-btn--primary cf-btn--small" href={data.pending_checkout.short_url} rel="noopener noreferrer">Finish payment</a>
              </div>
            ) : null}
            <div className="cf-card cf-card--padded" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {["monthly", "yearly"].map((key) => (
                  <button className={`cf-btn cf-btn--small ${cycle === key ? "cf-btn--primary" : "cf-btn--secondary"}`} key={key} type="button" onClick={() => setCycle(key)}>{key === "monthly" ? "Monthly" : "Yearly"}</button>
                ))}
              </div>
              <div className="cf-grid-2">
                {paidPlans.map((plan) => {
                  const current = plan.slug === data.plan_slug && data.billing_cycle === cycle && data.auto_pay && ["active", "past_due"].includes(data.status);
                  return (
                    <div className="cf-card cf-card--padded" key={plan.id}>
                      <strong>{plan.name}</strong>
                      <div className="cf-metric__value">{formatCurrency(plan.pricing[cycle])}<span className="cf-card__meta"> / {cycle === "monthly" ? "month" : "year"}</span></div>
                      {plan.description ? <p className="cf-card__meta">{plan.description}</p> : null}
                      <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy || current || !data.configured} type="button" onClick={() => pay(plan.slug)}>
                        {current ? "Current plan" : data.plan_slug === plan.slug ? "Pay for this plan" : "Switch to this plan"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="cf-card__meta" style={{ marginTop: 8 }}>Prices from Taskoora; GST is shown on the invoice Razorpay sends you. A new plan starts when its first payment goes through.</p>
            </div>
            {data.auto_pay && !data.cancel_at_period_end ? (
              <button className="cf-btn cf-btn--secondary" disabled={busy} style={{ marginTop: 12 }} type="button" onClick={cancel}>Stop automatic payment</button>
            ) : null}
            <div className="cf-card cf-card--padded" style={{ marginTop: 12, overflowX: "auto" }}>
              <div className="cf-page__overline">Payments</div>
              {(data.payments || []).length ? (
                <table className="cf-table">
                  <thead><tr><th>Date</th><th>Amount</th><th>Period</th><th>Method</th><th>Invoice</th></tr></thead>
                  <tbody>
                    {data.payments.map((row) => (
                      <tr key={row.payment_id}>
                        <td>{formatDateTime(row.created_at)}</td>
                        <td>{formatCurrency(row.amount)}</td>
                        <td>{formatDateTime(row.period_start)} - {formatDateTime(row.period_end)}</td>
                        <td>{row.method || "-"}</td>
                        <td className="cf-table__mono">{row.invoice_id || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="cf-card__meta">No payments yet.</p>}
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  );
};

export default PlanBilling;
