import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { getApiErrorMessage } from "../../../lib/apiErrors";
import { apiData } from "../../../lib/apiData";
import { formatCurrency } from "../../../lib/pos";
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded";

export function CashierSettlement({ apiUrl, outletId, currency = "INR", initiallyOpen = false }) {
  const [data, setData] = useState(null), [cash, setCash] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [page, setPage] = useState(1), [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [review, setReview] = useState(false);
  const scope = useRef(outletId), sequence = useRef(0);
  const initialLoad = useRef(null);
  scope.current = outletId;
  useEffect(() => {
    setData(null); setCash(""); setError(""); setBusy(false); setPage(1); setSearch(""); setQuery(""); setReview(false);
    return () => { sequence.current += 1; };
  }, [outletId]);
  const load = async (nextPage = page, nextQuery = query) => {
    const request = ++sequence.current, outlet = outletId;
    const current = () => request === sequence.current && scope.current === outlet;
    setBusy(true); setError(""); setReview(false);
    try {
      const config = { withCredentials: true, skipCache: true, params: { outlet_id: outlet } };
      const [currentResponse, historyResponse] = await Promise.all([
        axios.get(`${apiUrl}/api/billing/shifts/current`, config),
        axios.get(`${apiUrl}/api/billing/shifts/history`, { ...config, params: { ...config.params, page: nextPage, limit: 10, search: nextQuery } }),
      ]);
      const shift = apiData(currentResponse), history = apiData(historyResponse);
      const report = shift?.status === "open" ? apiData(await axios.get(`${apiUrl}/api/billing/cash-drawer`, config)) : null;
      if (!current()) return;
      if (!history || !Array.isArray(history.items)) throw new Error("Invalid settlement history response");
      if (shift?.status === "open" && (report?.expected_cash == null || !Number.isFinite(Number(report.expected_cash)))) throw new Error("Invalid cash drawer report");
      setData({ shift, report, history }); setPage(nextPage); setQuery(nextQuery);
    } catch (failure) { if (current()) setError(getApiErrorMessage(failure, "Unable to load settlement. Refresh before making changes.")); }
    finally { if (current()) setBusy(false); }
  };
  initialLoad.current = load;
  useEffect(() => { if (initiallyOpen) void initialLoad.current(1, ''); }, [initiallyOpen, apiUrl, outletId]);
  const open = data?.shift?.status === "open";
  const validCash = cash.trim() !== "" && Number.isFinite(Number(cash)) && Number(cash) >= 0 && /^\d+(\.\d{1,2})?$/.test(cash);
  const submit = async event => {
    event.preventDefault();
    if (!validCash || busy || error) return;
    if (open && !review) { setReview(true); return; }
    const outlet = outletId, request = ++sequence.current;
    setBusy(true); setError("");
    try {
      await axios.post(`${apiUrl}/api/billing/shifts/${open ? "close" : "open"}`, {
        outlet_id: outlet, shift_id: data?.shift?.id,
        [open ? "closing_cash" : "opening_cash"]: Number(cash),
      }, { withCredentials: true });
      if (scope.current !== outlet || sequence.current !== request) return;
      setCash(""); setReview(false); await load(1, query);
    } catch (failure) { if (scope.current === outlet && sequence.current === request) setError(getApiErrorMessage(failure, "Settlement was not confirmed. Refresh before retrying.")); }
    finally { if (scope.current === outlet) setBusy(false); }
  };
  const money = value => value == null ? "Not recorded" : formatCurrency(value, currency);
  // The core drawer figures always show; the rest only when this shift actually had them, so real amounts stand out.
  const metrics = report => [["Opening cash", report.opening_cash, true], ["Cash collected", report.cash_sales, true], ["Non-cash payments (UPI/card)", report.non_cash_sales, true],
    ["Cash refunds", report.cash_refunds], ["Pending confirmation", report.pending_payment_amount],
    ["Tips inside sales", report.tips_collected], ["Gift cards sold (cash)", report.gift_card_sales_cash], ["Gift cards sold (other)", report.gift_card_sales_other],
    ["Gift card cash payouts", report.gift_card_refunds_cash], ["Paid with gift cards", report.gift_card_redeemed]]
    .filter(([, value, always]) => always || Number(value || 0) !== 0);
  return <details open={initiallyOpen} className="cf-card cf-billing__support" onToggle={event => { if (!initiallyOpen && event.currentTarget.open && !data && !busy && !error) void load(); }}>
    <summary>Cashier shift & settlement</summary>
    <div className="cf-billing-panel">
      <div className="cf-billing-panel__heading"><div><h2>Cash drawer</h2><p role="status">{busy ? "Loading settlement…" : !data ? "Settlement not loaded" : open ? `Shift open · ${data.shift.opened_by_name || "Cashier"} · ${date(data.shift.opened_at)}` : data.shift?.status === "closed" ? `Shift closed · ${date(data.shift.closed_at)}. No open shift.` : "No open shift"}</p></div>
        <button type="button" className="cf-btn cf-btn--secondary" disabled={busy} onClick={() => load()}>Refresh settlement</button></div>
      {error && <p role="alert" className="cf-billing-panel__error">{error} Previously loaded figures may be out of date.</p>}
      {data && <>
        {data.report && <>
          <div className="cf-metrics" data-testid="drawer-summary">
            <div className="cf-metric"><div className="cf-metric__label">Expected cash in drawer</div><div className="cf-metric__value">{money(data.report.expected_cash)}</div><div className="cf-metric__sub">Opening cash + cash collected − cash refunds</div></div>
            <div className="cf-metric"><div className="cf-metric__label">Total collected this shift</div><div className="cf-metric__value">{money(Number(data.report.cash_sales || 0) + Number(data.report.non_cash_sales || 0))}</div><div className="cf-metric__sub">{data.report.bill_count || 0} bill{Number(data.report.bill_count) === 1 ? "" : "s"}</div></div>
          </div>
          {Number(data.shift?.opening_cash || 0) === 0 && <p className="cf-card__meta" role="note">This shift started with no opening cash recorded (the first bill opens a shift automatically). Next time, open the shift here with your starting float before billing.</p>}
          <dl className="cf-settlement-metrics">{metrics(data.report).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>
        </>}
        <section className="cf-settlement-action" aria-label={open ? "Close shift" : "Open shift"}>
          <h3>{open ? "Reconcile and close shift" : "Open a cashier shift"}</h3>
          <p>{open ? "Count the physical cash, then review the variance before closing." : "Enter the starting cash float in this outlet’s drawer."}</p>
          <form onSubmit={submit} className="cf-settlement-form">
            <label className="cf-field">{open ? "Counted cash" : "Opening cash"} ({currency})
              <input className="cf-input" aria-label={open ? "Counted cash" : "Opening cash"} inputMode="decimal" type="number" min="0" step="0.01" required disabled={busy} value={cash} onChange={event => { setCash(event.target.value); setReview(false); }} />
            </label>
            <button className="cf-btn cf-btn--primary" disabled={busy || !validCash || Boolean(error)}>{busy ? "Please wait…" : open ? review ? "Confirm shift closure" : "Review closing cash" : "Open shift"}</button>
          </form>
          {review && <div role="status" className="cf-settlement-review">Expected: {money(data.report?.expected_cash)} · Counted: {money(Number(cash))} · Variance: {money(Math.round((Number(cash) - Number(data.report?.expected_cash)) * 100) / 100)}.
            <p>Confirming stores this settlement permanently. Later collections belong to the next shift.</p>
            <button type="button" className="cf-btn cf-btn--secondary" onClick={() => setReview(false)} disabled={busy}>Keep shift open</button></div>}
        </section>
        <details className="cf-settlement-history"><summary>Settlement history · {data.history.pagination?.total ?? data.history.items.length} records</summary>
          <form className="cf-settlement-form" onSubmit={event => { event.preventDefault(); void load(1, search); }}>
            <label className="cf-field">Search cashier or shift ID<input className="cf-input" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <button type="submit" className="cf-btn cf-btn--secondary" disabled={busy}>Search history</button>
          </form>
          {!data.history.items.length && <p>{query ? "No settlements match this search." : "No closed shifts for this outlet."}</p>}
          {data.history.items.map(entry => <details key={entry.id} className="cf-settlement-history__entry"><summary>{date(entry.closed_at)} · {entry.closed_by_name || "Cashier"} · Variance {money(entry.variance)}</summary>
            <p>Opened by {entry.opened_by_name || "Not recorded"} · {date(entry.opened_at)}</p><p>Shift ID: {entry.id}</p>
            <dl className="cf-settlement-metrics">{[["Opening cash", entry.opening_cash], ["Cash collected", entry.report?.cash_sales], ["Non-cash confirmed", entry.report?.non_cash_sales], ["Cash refunds", entry.report?.cash_refunds], ["Expected cash", entry.expected_cash], ["Counted cash", entry.closing_cash], ["Variance", entry.variance]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>
          </details>)}
          <nav className="cf-billing-panel__actions" aria-label="Settlement history pages"><button type="button" className="cf-btn cf-btn--secondary" disabled={busy || page <= 1} onClick={() => load(page - 1)}>Previous</button><span>Page {page}</span><button type="button" className="cf-btn cf-btn--secondary" disabled={busy || !data.history.pagination?.has_more} onClick={() => load(page + 1)}>Next</button></nav>
        </details>
      </>}
    </div>
  </details>;
}
