import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { formatCurrency, hasPermission } from "../lib/pos";
import { apiData } from "../lib/apiData";

const today = () => new Date().toISOString().slice(0, 10);
const initialRange = () => ({ from: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to: today() });
const timeLabel = (value) => value == null ? "No samples" : `${value} min`;
const scoreLabel = (value) => value == null ? "No ratings" : `${value} / 5`;
const labels = { pending: "Awaiting approval", accepted: "Accepted", preparing: "Preparing", ready: "Ready", completed: "Served", rejected: "Rejected", cancelled: "Cancelled" };
const Metric = ({ title, value, detail }) => <article className="cf-card cf-card--padded"><div className="cf-metric__label">{title}</div><strong className="cf-metric__value">{value}</strong><p className="cf-card__meta">{detail}</p></article>;
const tableStyle = { overflowX: "auto", marginTop: 16 };

export function QrServiceAnalytics() {
  const { user } = useAuth(), { selectedOutletId } = useActiveOutlet();
  const [range, setRange] = useState(initialRange), [draft, setDraft] = useState(initialRange);
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(""), [dateError, setDateError] = useState(""), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [reviewFilter, setReviewFilter] = useState("all"), [notes, setNotes] = useState({});
  const scopeKey = `${selectedOutletId || "all"}:${range.from}:${range.to}`, currentScope = useRef(scopeKey), sequence = useRef(0);
  currentScope.current = scopeKey;
  const data = snapshot?.key === scopeKey ? snapshot.data : null;
  const canReview = hasPermission(user, "manager_view"), canManageOffers = hasPermission(user, "price_rules");
  const params = { from: range.from, to: range.to, ...(selectedOutletId ? { outlet_id: selectedOutletId } : {}) };
  const load = useCallback(async () => {
    const id = ++sequence.current;
    setLoading(true); setError("");
    try {
      const response = await axios.get(`${API_URL}/api/public/qr/analytics/service`, { params: { from: range.from, to: range.to, ...(selectedOutletId ? { outlet_id: selectedOutletId } : {}) }, withCredentials: true, skipCache: true });
      const payload = apiData(response);
      if (!payload?.summary || !Array.isArray(payload.daily)) throw new Error("Invalid analytics response");
      if (id === sequence.current && scopeKey === currentScope.current) setSnapshot({ key: scopeKey, data: payload });
    } catch (failure) {
      if (id === sequence.current && scopeKey === currentScope.current) {
        if (failure.response?.status === 403) setSnapshot(null);
        setError(failure.response?.status === 403 ? "Reports permission is required to view service analytics." : failure.response?.data?.error?.message || "Could not load service analytics. Please retry.");
      }
    } finally { if (id === sequence.current && scopeKey === currentScope.current) setLoading(false); }
  }, [range.from, range.to, selectedOutletId, scopeKey]);
  const invalidatePendingLoad = useCallback(() => { sequence.current++; }, []);
  useEffect(() => { load(); return invalidatePendingLoad; }, [load, invalidatePendingLoad]);
  useEffect(() => { setBusy(false); setNotes({}); }, [scopeKey]);
  const applyDates = (event) => {
    event.preventDefault();
    if (!draft.from || !draft.to || draft.from > draft.to || (Date.parse(draft.to) - Date.parse(draft.from)) / 86400000 >= 92) { setDateError("Choose a valid range of up to 92 days, with the start on or before the end."); return; }
    setDateError(""); setRange({ ...draft });
  };
  const updateReview = async (review, status) => {
    const key = scopeKey; setBusy(true); setError("");
    try {
      await axios.post(`${API_URL}/api/public/qr/analytics/feedback/${review.id}`, { status, internal_note: notes[review.id] ?? review.internal_note }, { params, withCredentials: true });
      if (key === currentScope.current) { setNotes((current) => { const next = { ...current }; delete next[review.id]; return next; }); await load(); }
    } catch (failure) { if (key === currentScope.current) setError(failure.response?.data?.error?.message || "Could not update the feedback review."); }
    finally { if (key === currentScope.current) setBusy(false); }
  };
  const download = () => {
    const csv = ["Date (UTC),QR orders,Assistance requests", ...data.daily.map((row) => `${row.date},${row.orders},${row.requests}`)].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `qr-service-${range.from}-${range.to}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const summary = data?.summary;
  const selectedReviews = reviewFilter === "attention" ? data?.attention_reviews || data?.reviews.filter((row) => row.needs_attention) || [] : data?.reviews || [];
  const maxDaily = Math.max(1, ...(data?.daily || []).map((row) => Math.max(row.orders, row.requests)));
  const chartX = (index, length) => length === 1 ? 300 : 30 + index / (length - 1) * 540;
  const chartPoints = (field) => (data?.daily || []).map((row, index, rows) => `${chartX(index, rows.length)},${130 - row[field] / maxDaily * 110}`).join(" ");
  return <section aria-label="QR service analytics">
    <header className="cf-page__header"><div><h2>Offers, feedback & service analytics</h2><p>For the selected outlet. Dates use UTC; repeat menu opens are counted separately.</p></div>
      {canManageOffers ? <a className="cf-btn cf-btn--secondary" href="/price-rules">Manage offers in Happy Hours</a> : null}
    </header>
    <form onSubmit={applyDates} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginBottom: 16 }}>
      <label>From<input className="cf-input" type="date" required value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>To<input className="cf-input" type="date" required value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <button className="cf-btn cf-btn--primary" type="submit">Apply dates</button><button className="cf-btn cf-btn--secondary" type="button" disabled={loading} onClick={load}>Refresh analytics</button>
      {data ? <button className="cf-btn cf-btn--secondary" type="button" onClick={download}>Download daily CSV</button> : null}
    </form>
    {dateError ? <p role="alert">{dateError}</p> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={load}>Retry</button></p> : null}
    {!data ? <p>{loading ? "Loading service analytics..." : "Choose dates or retry to load analytics."}</p> : <>
      <p>Showing {data.period.from} to {data.period.to} · Updated {new Date(data.checked_at).toLocaleTimeString()}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
        <Metric title="Recorded menu opens" value={summary.menu_opens} detail="Repeat opens counted using current table outlet mappings. Background refreshes excluded." />
        <Metric title="QR orders" value={summary.orders} detail={`${summary.accepted} accepted. Additional rounds count as separate orders.`} />
        <Metric title="Typical approval time" value={timeLabel(summary.median_approval_minutes)} detail={`Median of ${summary.approval_samples} recorded approvals.`} />
        <Metric title="Typical kitchen time" value={timeLabel(summary.median_prep_minutes)} detail={`${summary.prep_samples} timed orders ready; ${summary.late_prep} exceeded their prep target.`} />
        <Metric title="Assistance requests" value={summary.assistance_requests} detail={`${summary.open_requests} still open; ${summary.overdue_requests} need attention.`} />
        <Metric title="Guest rating" value={scoreLabel(summary.average_rating)} detail={`${summary.rating_samples} rated responses. ${summary.needs_attention} reviews need follow-up.`} />
      </div>
      <div className="cf-card cf-card--padded" style={{ marginTop: 16 }}>
        <h3>Daily QR activity</h3><p>Blue: orders placed. Green: assistance requested. These are counts, not unique guests or a conversion rate.</p>
        <svg role="img" aria-label="Daily QR orders and assistance requests" viewBox="0 0 600 160" style={{ width: "100%", maxHeight: 220 }}>
          <text x="0" y="20" fontSize="12">{maxDaily}</text><text x="10" y="135" fontSize="12">0</text>
          <line x1="30" y1="130" x2="570" y2="130" stroke="#cbd5e1" />
          <polyline points={chartPoints("orders")} fill="none" stroke="#2563eb" strokeWidth="3" />
          <polyline points={chartPoints("requests")} fill="none" stroke="#0d9488" strokeWidth="3" />
          {data.daily.map((row, index, rows) => <g key={row.date}>
            <circle cx={chartX(index, rows.length)} cy={130 - row.orders / maxDaily * 110} r="3" fill="#2563eb"><title>{row.date}: {row.orders} orders</title></circle>
            <circle cx={chartX(index, rows.length)} cy={130 - row.requests / maxDaily * 110} r="3" fill="#0d9488"><title>{row.date}: {row.requests} requests</title></circle>
          </g>)}
          <text x="30" y="155" fontSize="12">{data.period.from}</text><text x="490" y="155" fontSize="12">{data.period.to}</text>
        </svg>
        <details><summary>View daily numbers</summary><div style={tableStyle}><table className="cf-table"><thead><tr><th>Date (UTC)</th><th>Orders</th><th>Requests</th></tr></thead><tbody>{data.daily.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.orders}</td><td>{row.requests}</td></tr>)}</tbody></table></div></details>
        <h3>Order progress now</h3><p>Current status of orders placed in this date range; billing does not mean food was served.</p>
        {data.pipeline.map((row) => <div key={row.status} style={{ display: "flex", gap: 12, alignItems: "center", margin: "8px 0" }}><span style={{ minWidth: 145 }}>{labels[row.status] || row.status}</span><progress aria-label={labels[row.status] || row.status} value={row.count} max={Math.max(summary.orders, 1)} /><strong>{row.count}</strong></div>)}
      </div>
      <div className="cf-card cf-card--padded" style={{ marginTop: 16 }}>
        <h3>Table assistance</h3><p>Response: request to acceptance. Resolution: request to completion. Only recorded timestamps are used; ended visits appear as expired.</p>
        <div style={tableStyle}><table className="cf-table"><thead><tr><th>Request</th><th>Total</th><th>Completed</th><th>Open / overdue</th><th>Expired</th><th>Typical response</th><th>Typical resolution</th></tr></thead><tbody>
          {data.assistance.map((row) => <tr key={row.kind}><td>{row.label}</td><td>{row.total}</td><td>{row.resolved}</td><td>{row.open} / {row.overdue}</td><td>{row.expired}</td><td>{timeLabel(row.median_response_minutes)} ({row.response_samples} samples)</td><td>{timeLabel(row.median_resolution_minutes)} ({row.resolution_samples} samples)</td></tr>)}
          {!data.assistance.length ? <tr><td colSpan="7">No assistance requests in this period.</td></tr> : null}
        </tbody></table></div>
      </div>
      <div className="cf-card cf-card--padded" style={{ marginTop: 16 }}>
        <h3>Offer use</h3><p>Recorded discounts on accepted QR orders, excluding cancelled/rejected orders. Savings apply to base item prices; these figures are not collected revenue.</p>
        <div style={tableStyle}><table className="cf-table"><thead><tr><th>Offer</th><th>Orders</th><th>Units</th><th>Guest savings</th></tr></thead><tbody>{data.offers.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.orders}</td><td>{row.units}</td><td>{formatCurrency(row.savings)}</td></tr>)}{!data.offers.length ? <tr><td colSpan="4">No accepted QR orders with offers in this period.</td></tr> : null}</tbody></table></div>
      </div>
      <div className="cf-card cf-card--padded" style={{ marginTop: 16 }}>
        <h3>Guest feedback & follow-up</h3><p>Reviews submitted in this period. Food: {scoreLabel(summary.food_rating)} · Service: {scoreLabel(summary.service_rating)}.</p>
        {data.rating_distribution.map((row) => <div key={row.rating}>{row.rating} stars <progress aria-label={`${row.rating} star ratings`} value={row.count} max={Math.max(summary.rating_samples, 1)} /> {row.count}</div>)}
        <label>Show reviews <select className="cf-select" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}><option value="all">All reviews</option><option value="attention">Needs follow-up</option></select></label>
        <p>Showing up to 100 {reviewFilter === "attention" ? "reviews needing follow-up" : "recent reviews"} of {reviewFilter === "attention" ? summary.needs_attention : data.reviews_total}. Internal notes are private to staff; saving a review does not message the guest.</p>
        {selectedReviews.map((review) => <article key={review.id} style={{ borderTop: "1px solid #ddd", padding: "16px 0" }}>
          <strong>{review.table} · {scoreLabel(review.rating)} · {review.status}</strong>{review.needs_attention ? <b> · Needs follow-up</b> : null}
          <p>Food: {scoreLabel(review.food_rating)} · Service: {scoreLabel(review.service_rating)}</p>
          <p>{review.comment || "No written comment."}</p><small>{new Date(review.created_at).toLocaleString()} · {review.topics.join(", ")}</small>
          {canReview ? <div><label>Private follow-up note<textarea className="cf-textarea" maxLength={500} value={notes[review.id] ?? review.internal_note} onChange={(event) => setNotes({ ...notes, [review.id]: event.target.value })} /></label>
            <div>{["new", "reviewing", "resolved"].map((status) => <button className="cf-btn cf-btn--secondary" type="button" key={status} disabled={busy} onClick={() => updateReview(review, status)}>{status === "new" ? "Reopen" : status === "reviewing" ? "Mark reviewing" : "Mark resolved"}</button>)}</div>
          </div> : null}
          {review.history.length ? <details><summary>Review history</summary>{review.history.map((event, index) => <p key={index}>{event.status} · {event.actor_name || "Staff"} · {new Date(event.at).toLocaleString()}</p>)}</details> : null}
        </article>)}
        {!selectedReviews.length ? <p>{reviewFilter === "attention" ? "No reviews need follow-up in this period." : "No QR feedback submitted in this period."}</p> : null}
      </div>
    </>}
  </section>;
}
