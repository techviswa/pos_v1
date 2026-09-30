import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { formatCurrency } from "../../lib/pos";

const POLL_MS = 3000;
const MAX_POLL_MS = 35 * 60 * 1000;

/**
 * Collects a bill payment through Razorpay: a UPI QR on screen (or a payment link by SMS for cards), confirmed
 * automatically. The till asks the server every few seconds; the server asks Razorpay, so this works even before
 * webhooks are set up. Staff cannot mark it paid by hand: they cancel the request and take the money another way.
 */
export const RazorpayCollect = ({ apiUrl, intent, customerPhone, currency, onIntentChange }) => {
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(Date.now());
  const status = intent?.status;

  useEffect(() => {
    if (status !== "pending") return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (Date.now() - startedAt.current > MAX_POLL_MS) {
        window.clearInterval(timer);
        return;
      }
      try {
        const response = await axios.post(`${apiUrl}/api/payments/intents/${intent.id}/refresh`, {}, { withCredentials: true });
        const next = apiData(response);
        if (!cancelled && next && next.status !== "pending") {
          onIntentChange(next);
          if (next.status === "confirmed") toast.success(`Payment received: ${formatCurrency(next.amount, currency)}`);
        }
      } catch {
        // A missed check is retried on the next tick.
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiUrl, currency, intent?.id, onIntentChange, status]);

  const sendLink = async () => {
    setBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/api/payments/intents`, {
        provider: "razorpay", razorpay_mode: "link", method: intent.method, amount: intent.amount, invoice_id: intent.invoice_id,
        customer_phone: customerPhone || undefined, note: `Bill ${intent.invoice_id}`,
      }, { withCredentials: true });
      startedAt.current = Date.now();
      onIntentChange(apiData(response));
      toast.success(customerPhone ? "Payment link sent by SMS" : "Payment link created");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not create the payment link"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      const response = await axios.post(`${apiUrl}/api/payments/intents/${intent.id}/cancel`, {}, { withCredentials: true });
      const next = apiData(response);
      onIntentChange(next);
      toast[next.status === "confirmed" ? "success" : "info"](next.status === "confirmed" ? "It was already paid" : "Request cancelled; take the payment another way");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not cancel the request"));
    } finally {
      setBusy(false);
    }
  };

  if (!intent) return null;
  const razorpay = intent.razorpay || {};
  return (
    <div className="cf-payment-intent" data-testid="razorpay-collect">
      <div className="cf-page__overline" style={{ marginBottom: 8 }}>
        Razorpay {razorpay.mode === "link" ? "payment link" : "UPI QR"} · {formatCurrency(intent.amount, currency)}
      </div>
      {status === "confirmed" ? (
        <div role="status" style={{ color: "var(--cf-green, #067647)", fontWeight: 600 }}>✓ Paid through Razorpay ({razorpay.payment_id})</div>
      ) : status === "pending" ? (
        <>
          {razorpay.mode === "qr" && razorpay.image_url ? (
            <img alt="Scan to pay with any UPI app" src={razorpay.image_url} style={{ width: 220, maxWidth: "100%", display: "block", margin: "0 auto 8px" }} />
          ) : null}
          {razorpay.mode === "link" && razorpay.short_url ? (
            <div className="cf-table__mono" style={{ wordBreak: "break-all", marginBottom: 8 }}>{razorpay.short_url}</div>
          ) : null}
          <div className="cf-card__meta" style={{ marginBottom: 8 }}>Waiting for payment… it confirms here automatically.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {razorpay.mode === "qr" ? (
              <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} type="button" onClick={sendLink}>
                {customerPhone ? "Send payment link by SMS" : "Create payment link"}
              </button>
            ) : null}
            <button className="cf-btn cf-btn--secondary cf-btn--small" disabled={busy} type="button" onClick={cancel}>Cancel (pay another way)</button>
          </div>
        </>
      ) : (
        <div className="cf-card__meta">This request is {status}. Take the payment another way.</div>
      )}
      {intent.needs_attention || (razorpay.unwanted_payments || []).length ? (
        <div role="alert" style={{ color: "var(--cf-red)", fontSize: 12, marginTop: 6 }}>
          {intent.needs_attention
            ? "A payment arrived that could not be refunded automatically. Ask a manager to refund it from the Razorpay dashboard."
            : "An extra payment for this request was refunded to the customer automatically."}
        </div>
      ) : null}
    </div>
  );
};
