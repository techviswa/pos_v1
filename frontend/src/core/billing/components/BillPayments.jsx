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
// Money still owed on the bill: total minus every payment that is received or waiting for confirmation.
const openBalance = (bill, payments) => Math.max(0, Math.round((Number(bill.total || 0)
  - payments.filter((row) => !["failed", "cancelled"].includes(row.status)).reduce((sum, row) => sum + Number(row.amount || 0), 0)) * 100) / 100);
const COLLECT_METHODS = ["Cash", "UPI", "Card"];

export const BillPayments = ({ apiUrl, bill, currency, canRefund, canCollect = false, canConfirm = false, onChanged }) => {
  const payments = useMemo(() => bill.payments || [], [bill.payments]);
  const refunds = useMemo(() => bill.refunds || [], [bill.refunds]);
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
  const [collect, setCollect] = useState(null);
  const collectKey = useRef("");
  const [confirming, setConfirming] = useState(null);
  const balance = openBalance(bill, payments);

  // Unpaid bills (QR table bills, "Due" bills) are settled here. Cash counts at once; UPI/card wait for a manager to
  // confirm the transaction reference, exactly as at the till. One request key per open form: a double tap or a
  // retry after a timeout records the payment once.
  const openCollect = () => {
    collectKey.current = newClientKey();
    setCollect({ amount: String(balance), method: "Cash", reference: "" });
  };
  const submitCollect = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/api/billing/${bill.id}/payments`, {
        amount: Number(collect.amount), method: collect.method, reference: collect.reference.trim() || undefined, client_request_id: collectKey.current,
      }, { withCredentials: true });
      toast.success(collect.method === "Cash" ? "Cash payment recorded" : `${collect.method} payment recorded, waiting for a manager to confirm it`);
      setCollect(null);
      onChanged?.(apiData(response));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Payment could not be recorded"));
    } finally {
      setBusy(false);
    }
  };
  // A wrong bill is cancelled in two steps: staff ask, an Owner/Manager approves. Money already collected must be
  // refunded first (the server refuses otherwise and says so).
  const voidAction = async (path, body, message) => {
    setBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/api/billing/${bill.id}/${path}`, body, { withCredentials: true });
      toast.success(message);
      onChanged?.(apiData(response));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "The bill could not be updated"));
    } finally {
      setBusy(false);
    }
  };
  const requestVoid = () => {
    const reason = window.prompt("Why should this bill be cancelled (voided)?") || "";
    if (reason.trim()) void voidAction("void-request", { reason: reason.trim() }, "Void requested. A manager must approve it.");
  };

  const submitConfirm = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/api/billing/${bill.id}/payments/${confirming.id}/confirm`, { reference: confirming.reference.trim() }, { withCredentials: true });
      toast.success("Payment confirmed");
      setConfirming(null);
      onChanged?.(apiData(response));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Payment could not be confirmed"));
    } finally {
      setBusy(false);
    }
  };

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
          {canConfirm && row.status === "pending_confirmation" && !row.gateway_intent_id && confirming?.id !== row.id ? (
            <button className="cf-btn cf-btn--secondary cf-btn--small" style={{ marginLeft: 8 }} type="button" onClick={() => setConfirming({ id: row.id, reference: row.reference || "" })}>Confirm</button>
          ) : null}
          {confirming?.id === row.id ? (
            <form onSubmit={submitConfirm} style={{ display: "flex", gap: 6, marginTop: 6 }} data-testid="confirm-payment-form">
              <input aria-label="Transaction reference" className="cf-input" maxLength={80} placeholder="UPI / card transaction reference" required value={confirming.reference} onChange={(event) => setConfirming({ ...confirming, reference: event.target.value })} />
              <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} type="button" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy} type="submit">{busy ? "Confirming..." : "Confirm received"}</button>
            </form>
          ) : null}
        </div>
      )) : <div className="cf-card__meta">No payments yet.</div>}
      {balance > 0 && bill.status !== "void" ? (
        <div className="cf-card__meta" style={{ marginTop: 6, fontWeight: 600 }} data-testid="bill-balance">Still to collect: {formatCurrency(balance, currency)}</div>
      ) : null}
      {canCollect && balance > 0 && bill.status !== "void" ? (
        collect ? (
          <form onSubmit={submitCollect} style={{ display: "grid", gap: 6, marginTop: 8 }} data-testid="collect-form">
            <select aria-label="Payment method" className="cf-select" value={collect.method} onChange={(event) => setCollect({ ...collect, method: event.target.value })}>
              {COLLECT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
            </select>
            <input aria-label="Amount received" className="cf-input" max={balance} min="0.01" required step="0.01" type="number" value={collect.amount} onChange={(event) => setCollect({ ...collect, amount: event.target.value })} />
            {collect.method !== "Cash" ? (
              <input aria-label="Transaction reference" className="cf-input" maxLength={80} placeholder="Transaction reference (optional now, needed to confirm)" value={collect.reference} onChange={(event) => setCollect({ ...collect, reference: event.target.value })} />
            ) : null}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} type="button" onClick={() => setCollect(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary cf-btn--small" disabled={busy} type="submit">{busy ? "Saving..." : "Record payment"}</button>
            </div>
          </form>
        ) : (
          <button className="cf-btn cf-btn--primary cf-btn--small" style={{ marginTop: 8 }} type="button" data-testid="collect-payment" onClick={openCollect}>
            Collect payment ({formatCurrency(balance, currency)})
          </button>
        )
      ) : null}
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
      {bill.status === "void" ? (
        <div className="cf-card__meta" role="status" style={{ marginTop: 8, fontWeight: 600 }}>This bill is voided{bill.void_reason ? `: ${bill.void_reason}` : ""}.</div>
      ) : bill.void_status === "pending_approval" ? (
        <div className="cf-card__meta" role="status" style={{ marginTop: 8 }} data-testid="void-pending">
          Void requested{bill.void_requested_by_name ? ` by ${bill.void_requested_by_name}` : ""}: {bill.void_reason}
          {canConfirm ? (
            <span style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
              <button className="cf-btn cf-btn--danger cf-btn--small" disabled={busy} type="button" onClick={() => voidAction("void-approval", { approved: true }, "Bill voided")}>Approve void</button>
              <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} type="button" onClick={() => voidAction("void-approval", { approved: false }, "Void request rejected")}>Reject</button>
            </span>
          ) : " Waiting for a manager."}
        </div>
      ) : canCollect ? (
        <button className="cf-btn cf-btn--secondary cf-btn--small" style={{ marginTop: 8, marginLeft: 8 }} disabled={busy} type="button" onClick={requestVoid}>Request void</button>
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
