import React, { useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { apiData } from "../../../lib/apiData";
import { getApiErrorMessage } from "../../../lib/apiErrors";
import { formatCurrency, newClientKey } from "../../../lib/pos";

const REFUND_STATUS = { processed: "refunded", pending: "being refunded", created: "being refunded", failed: "FAILED" };

/**
 * A bill's payments and refunds, and (for Owners/Managers) giving money back. A refund "to UPI/card" goes to Razorpay
 * first and is only recorded once Razorpay accepts it; the same request key is kept while the form is open, so pressing
 * the button twice or retrying after a timeout never refunds twice.
 */
export const BillPayments = ({ apiUrl, bill, currency, canRefund, onChanged }) => {
  const payments = bill.payments || [];
  const refunds = bill.refunds || [];
  const refundedTotal = refunds.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const paidTotal = Number(bill.paid_amount || 0);
  const refundable = Math.max(0, Math.round((paidTotal - refundedTotal) * 100) / 100);
  const gatewayRoom = useMemo(() => {
    const back = new Map();
    for (const refund of refunds) for (const part of refund.gateway_refunds || []) back.set(part.payment_id, (back.get(part.payment_id) || 0) + Number(part.amount || 0));
    return payments.filter((row) => row.status === "confirmed" && row.gateway === "razorpay")
      .reduce((sum, row) => sum + Math.max(0, Number(row.amount) - (back.get(row.gateway_payment_id) || 0)), 0);
  }, [payments, refunds]);
  const methods = useMemo(() => {
    const options = [];
    if (gatewayRoom > 0) options.push({ value: "Razorpay", label: `Back to customer's UPI/card via Razorpay (up to ${formatCurrency(gatewayRoom, currency)})` });
    options.push({ value: "Cash", label: "Cash handed back" });
    if (payments.some((row) => row.status === "confirmed" && row.method === "Gift Card")) options.push({ value: "Gift Card", label: "Back onto the gift card" });
    for (const method of new Set(payments.filter((row) => row.status === "confirmed" && !row.gateway && !["Cash", "Gift Card"].includes(row.method)).map((row) => row.method))) {
      options.push({ value: method, label: `${method} (returned outside the POS)` });
    }
    return options;
  }, [currency, gatewayRoom, payments]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef("");

  const openForm = () => {
    requestKey.current = newClientKey();
    setForm({ amount: String(refundable), method: methods[0]?.value || "Cash", reason: "" });
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/api/billing/${bill.id}/refunds`, {
        amount: Number(form.amount), method: form.method, reason: form.reason, client_request_id: requestKey.current,
      }, { withCredentials: true });
      toast.success(form.method === "Razorpay" ? "Refund sent to the customer through Razorpay" : "Refund recorded");
      setForm(null);
      onChanged?.(apiData(response));
    } catch (error) {
      // A partial Razorpay refund is already recorded; refresh so staff see exactly what went back.
      toast.error(getApiErrorMessage(error, "Refund failed"));
      onChanged?.(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="bill-payments">
      <div className="cf-page__overline" style={{ marginBottom: 6 }}>Payments</div>
      {payments.length ? payments.map((row) => (
        <div className="cf-card__meta" key={row.id}>
          {row.method} {formatCurrency(row.amount, currency)} · {row.status === "confirmed" ? "received" : row.status === "pending_confirmation" ? "waiting for confirmation" : row.status}
          {row.gateway === "razorpay" ? " · via Razorpay" : ""}{row.reference ? ` · ref ${row.reference}` : ""}
        </div>
      )) : <div className="cf-card__meta">No payments yet.</div>}
      {refunds.length ? (
        <>
          <div className="cf-page__overline" style={{ margin: "8px 0 6px" }}>Refunds</div>
          {refunds.map((row) => (
            <div className="cf-card__meta" key={row.id}>
              {formatCurrency(row.amount, currency)} · {row.method} · {row.reason}
              {(row.gateway_refunds || []).map((part) => ` · Razorpay ${REFUND_STATUS[part.status] || part.status} (${part.refund_id})`).join("")}
            </div>
          ))}
        </>
      ) : null}
      {bill.gateway_refund_failed ? (
        <div role="alert" style={{ color: "var(--cf-red)", fontSize: 12, marginTop: 6 }}>
          A Razorpay refund failed: the customer has not got that money back. Refund it again or in cash.
        </div>
      ) : null}
      {canRefund && refundable > 0 && bill.status !== "void" ? (
        form ? (
          <form onSubmit={submit} style={{ display: "grid", gap: 6, marginTop: 8 }} data-testid="refund-form">
            <select aria-label="Refund method" className="cf-select" value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}>
              {methods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input aria-label="Refund amount" className="cf-input" max={refundable} min="0.01" required step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            <input aria-label="Refund reason" className="cf-input" maxLength={300} placeholder="Reason" required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} type="button" onClick={() => setForm(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy} type="submit">{busy ? "Refunding..." : "Refund"}</button>
            </div>
          </form>
        ) : (
          <button className="cf-btn cf-btn--secondary cf-btn--small" style={{ marginTop: 8 }} type="button" onClick={openForm}>
            Refund (up to {formatCurrency(refundable, currency)})
          </button>
        )
      ) : null}
    </div>
  );
};
