import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { resolveQrApiBaseUrl } from "../lib/qrUrls";
import { formatCurrency, newClientKey } from "../lib/pos";
import { pendingRequest, clearPendingRequest } from "../lib/qrVisit";

const API = resolveQrApiBaseUrl(process.env.REACT_APP_BACKEND_URL);
const unwrap = (response) => response?.data?.data ?? response?.data;
export const splitAmounts = (total, count) => {
  const paise = Math.round(Number(total) * 100), base = Math.floor(paise / count), remainder = paise % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
};

export function QrCheckout({ trackingToken }) {
  const base = `${API}/api/public/qr/orders/${encodeURIComponent(trackingToken)}`;
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(""), [people, setPeople] = useState(2);
  const [billId, setBillId] = useState("");
  const selectedBill = useRef(""); selectedBill.current = billId;
  const [verification, setVerification] = useState(null), [otp, setOtp] = useState(""), [loyalty, setLoyalty] = useState(null), [points, setPoints] = useState("0");
  const mounted = useRef(true), loading = useRef(new Set()), paymentKey = `qr-checkout:${trackingToken}:${billId || data?.bill?.id || "default"}`;
  const load = async () => {
    const selected = selectedBill.current;
    if (loading.current.has(selected)) return;
    loading.current.add(selected);
    try {
      const result = unwrap(await axios.get(`${base}/checkout`, { params: selected ? { bill_id: selected } : {}, timeout: 15000, skipCache: true }));
      if (mounted.current && selected === selectedBill.current) {
        setData(result); setError("");
        if (result.bill && !result.active_payment) clearPendingRequest(paymentKey);
      }
    } catch (requestError) { if (mounted.current && selected === selectedBill.current) setError(requestError.response?.data?.error?.message || "Could not refresh your bill. Please try again."); }
    finally { loading.current.delete(selected); }
  };
  useEffect(() => {
    mounted.current = true;
    load();
    const refresh = () => { if (!document.hidden) load(); };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
    // The parent keys this component by the tracking capability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingToken]);
  useEffect(() => { setData(null); load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);
  const due = data?.bill?.due_amount;
  useEffect(() => { if (due != null) setAmount(Number(due).toFixed(2)); }, [due]);
  const action = async (work) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); }
    catch (requestError) { if (mounted.current) setError(requestError.response?.data?.error?.message || "Unable to complete this request. Try again or ask staff."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const post = async (path, body = {}) => unwrap(await axios.post(`${base}/${path}`, body, { timeout: 30000 }));
  const requestBill = () => action(async () => {
    await post("checkout/request", { points: loyalty ? Number(points) : 0, verification_token: verification?.verification_token });
    await load();
  });
  const pay = () => action(async () => {
    const request = pendingRequest(paymentKey, JSON.stringify([data.bill.id, Number(amount)]), newClientKey);
    const intent = await post("checkout/pay", { amount: Number(amount), client_request_id: request.key, bill_id: data.bill.id });
    if (intent.status !== "pending") clearPendingRequest(paymentKey);
    await load();
  });
  const updatePayment = (mode) => action(async () => {
    const intent = await post(`checkout/payments/${data.active_payment.id}/${mode}`, { bill_id: data.bill.id });
    if (intent.status !== "pending") clearPendingRequest(paymentKey);
    await load();
  });
  const bill = data?.bill, pending = data?.active_payment;
  const closed = ["void", "refunded"].includes(bill?.status);
  const url = pending?.url?.startsWith("https://") ? pending.url : null;
  return <section className="cf-qr-cart" aria-label="Bill, split payments and loyalty" style={{ marginTop: 20 }}>
    <h2>Your bill & payment</h2>
    {error ? <div role="alert">{error} <button type="button" onClick={load}>Retry</button></div> : null}
    {!data ? <p>Loading bill...</p> : !bill ? <>
      <p>The restaurant will issue your final bill, including tax and any loyalty discount. Order totals above are not a payment receipt.</p>
      <button type="button" disabled={busy} onClick={requestBill}>{data.requested ? "Update bill request" : "Request final bill"}</button>
      {data.requested ? <p role="status">Bill requested. Waiting for staff. Points requested: {data.redeem_points_requested || 0}.</p> : null}
      <h3>Loyalty points</h3>
      {!loyalty ? <>
        <p>Verify the phone used for this order to see your points and request redemption.</p>
        <button type="button" disabled={busy} onClick={() => action(async () => { setVerification(await post("loyalty/code")); })}>Send verification code</button>
        {verification ? <div>
          <label>Verification code <input inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value)} /></label>
          {verification.dev_otp ? <p>Development code: {verification.dev_otp}</p> : <p>A code was sent to the phone used for this order.</p>}
          <button type="button" disabled={busy || otp.length !== 6} onClick={() => action(async () => { setLoyalty(await post("loyalty/verify", { verification_token: verification.verification_token, otp })); })}>Verify phone</button>
        </div> : null}
      </> : <>
        <p>Available points: <strong>{loyalty.points}</strong></p>
        {loyalty.rules.enabled ? <>
          <p>{loyalty.rules.earn_percent}% earned as points after full payment. 1 point = {formatCurrency(loyalty.rules.point_value)}. Minimum redemption: {loyalty.rules.min_redeem_points} points; maximum {loyalty.rules.max_redeem_percent}% of eligible items.</p>
          <label>Points to request <input type="number" min="0" max={loyalty.points} step="1" value={points} onChange={(event) => setPoints(event.target.value)} /></label>
          <p>Points are checked and deducted when staff issue the bill. Requests do not reserve points.</p>
        </> : <p>The restaurant's loyalty programme is switched off.</p>}
      </>}
    </> : <>
      {data.invoices?.length > 1 ? <label>Your order's invoices <select disabled={busy} value={bill.id} onChange={(event) => setBillId(event.target.value)}>{data.invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · remaining {formatCurrency(invoice.due_amount)}</option>)}</select></label> : null}
      <p>Invoice {bill.number}</p>
      <ul>{bill.items?.map((item) => <li key={item.id}>{item.name} {item.variation} × {item.quantity} · {formatCurrency(item.price * item.quantity)}</li>)}</ul>
      <dl>
        <dt>Items</dt><dd>{formatCurrency(bill.subtotal)}</dd>
        {bill.discount ? <><dt>Discount</dt><dd>-{formatCurrency(bill.discount)}</dd></> : null}
        {bill.loyalty_discount ? <><dt>Loyalty discount ({bill.loyalty_points_redeemed} points)</dt><dd>-{formatCurrency(bill.loyalty_discount)}</dd></> : null}
        {bill.service_charge ? <><dt>Service charge</dt><dd>{formatCurrency(bill.service_charge)}</dd></> : null}
        <dt>Tax</dt><dd>{formatCurrency(bill.tax)}</dd>
        {bill.tip ? <><dt>Tip</dt><dd>{formatCurrency(bill.tip)}</dd></> : null}
        <dt>Total</dt><dd>{formatCurrency(bill.total)}</dd><dt>Paid</dt><dd>{formatCurrency(bill.paid_amount)}</dd><dt>Remaining</dt><dd>{formatCurrency(bill.due_amount)}</dd>
      </dl>
      {closed ? <p>This bill is {bill.status}. Please contact staff about any refund.</p> : Number(due) <= 0 ? <p role="status">Bill paid. Thank you! Loyalty points earned: {bill.loyalty_points_earned || 0}.</p> : <>
        {(data.payments || []).length ? <p>Confirmed payments: {data.payments.map((payment) => `${formatCurrency(payment.amount)} (${payment.method})`).join(", ")}</p> : null}
        {pending ? <div>
          <p>Payment in progress: {formatCurrency(pending.amount)}. This is not confirmed until the restaurant receives gateway confirmation.</p>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer">Open secure payment page</a> : <p>Payment link is being prepared. Retry the status check or ask staff.</p>}
          <button type="button" disabled={busy} onClick={() => updatePayment("refresh")}>Check payment status</button>
          <button type="button" disabled={busy} onClick={() => updatePayment("cancel")}>Cancel payment request</button>
        </div> : data.staff_payment_in_progress ? <p>A cashier payment is in progress. Please complete it with staff.</p> : data.online_enabled ? <>
          <h3>Pay in full or split this bill</h3>
          <p>Shares are paid one at a time. Each confirmed payment reduces the same invoice's remaining balance.</p>
          <label>Split into <select value={people} onChange={(event) => setPeople(Number(event.target.value))}>{Array.from({ length: 19 }, (_, index) => index + 2).map((count) => <option key={count} value={count}>{count} shares</option>)}</select></label>
          <div>{splitAmounts(bill.total, people).map((share, index) => <button type="button" key={index} onClick={() => setAmount(Math.min(share, Number(due)).toFixed(2))}>Share {index + 1}: {formatCurrency(share)}</button>)}</div>
          <button type="button" onClick={() => setAmount(Number(due).toFixed(2))}>Pay remaining balance</button>
          <label>Amount to pay <input type="number" min="0.01" max={due} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <button type="button" disabled={busy || !(Number(amount) > 0) || Number(amount) > Number(due)} onClick={pay}>Create secure payment link</button>
        </> : <p>Online payment is not enabled for this restaurant. Please pay staff by cash, card or UPI; confirmed payments will appear here.</p>}
      </>}
    </>}
  </section>;
}
