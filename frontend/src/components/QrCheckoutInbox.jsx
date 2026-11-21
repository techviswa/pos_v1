import React, { useEffect, useId, useRef, useState } from "react";
import axios from "axios";
import { API_URL } from "../contexts/AuthContext";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { formatCurrency } from "../lib/pos";
import { apiData } from "../lib/apiData";
import { QrVisitBilling } from "./QrVisitBilling";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

export function QrCheckoutInbox({ currency = "INR", compact = false }) {
  const descriptionId = useId();
  const [allocation, setAllocation] = useState(null);
  const allocationCurrent = useRef(allocation); allocationCurrent.current = allocation;
  const { selectedOutletId } = useActiveOutlet();
  const [items, setItems] = useState([]), [error, setError] = useState(""), [hidden, setHidden] = useState(false), [busy, setBusy] = useState(false);
  const current = useRef(selectedOutletId); current.current = selectedOutletId;
  const sequence = useRef(0), generation = useRef(0);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const load = async () => {
    const outlet = selectedOutletId;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/api/public/qr/checkout/inbox`, { params: { ...(outlet && outlet !== "all" ? { outlet_id: outlet } : {}), page }, withCredentials: true, skipCache: true });
      if (outlet !== current.current || request !== sequence.current) return;
      const payload = apiData(response);
      const rows = Array.isArray(payload) ? payload : payload?.items;
      if (!Array.isArray(rows)) throw new Error("Invalid bill request response");
      setItems(rows); setHasMore(Boolean(payload?.has_more)); setLoaded(true); setReadFailed(false); setError("");
      if (rows.length && !compact) setExpanded(true);
    } catch (failure) { if (outlet !== current.current || request !== sequence.current) return; if (failure.response?.status === 403) setHidden(true); else { setReadFailed(true); setError("Unable to load QR bill requests. Previously loaded requests may be out of date."); if (!compact) setExpanded(true); } }
    finally { if (outlet === current.current && request === sequence.current) setLoading(false); }
  };
  useEffect(() => { generation.current += 1; setItems([]); setHidden(false); setAllocation(null); setLoaded(false); setReadFailed(false); setError(""); setBusy(false); setPage(1); setHasMore(false); setExpanded(false); return () => { sequence.current += 1; generation.current += 1; }; }, [selectedOutletId]);
  useAutoRefresh(load, { enabled: !hidden, refreshKey: `${selectedOutletId}:${page}`, liveResources: ["qr_orders", "bills"], refreshOnFocus: true });
  const issue = async (order, applyPoints = true) => {
    const outlet = selectedOutletId, epoch = generation.current;
    setBusy(true); setError("");
    try { await axios.post(`${API_URL}/api/public/qr/checkout/${order.id}/issue`, { apply_points: applyPoints }, { withCredentials: true }); if (epoch === generation.current && outlet === current.current) await load(); }
    catch (failure) { if (epoch === generation.current && outlet === current.current) setError(failure.response?.data?.error?.message || "Could not issue this bill. Check the guest's points and your shift."); }
    finally { if (epoch === generation.current && outlet === current.current) setBusy(false); }
  };
  if (hidden) return null;
  const content = <div className="cf-billing-panel">
    <div className="cf-billing-panel__heading"><h2>Guest bill requests</h2><button type="button" className="cf-btn cf-btn--secondary" disabled={loading || busy} onClick={load}>{loading ? "Refreshing…" : "Refresh requests"}</button></div>
    <p id={descriptionId}>Issue an unpaid invoice for the guest to review and pay. This does not confirm a payment.</p>
    {busy && <p role="status">Issuing unpaid invoice…</p>}
    {error ? <p role="alert" className="cf-billing-panel__error">{error} <button type="button" className="cf-btn cf-btn--secondary" disabled={loading || busy} onClick={load}>Retry</button></p> : null}
    {allocation ? <QrVisitBilling key={allocation.id} orderId={allocation.id} onClose={() => { if (allocationCurrent.current === allocation) setAllocation(null); }} onIssued={() => { if (allocationCurrent.current !== allocation || allocation.epoch !== generation.current || allocation.outlet !== current.current) return; setAllocation(null); void load(); }} /> : null}
    {!error && !loading && loaded && !items.length ? <p>{page === 1 && !hasMore ? "No final bill requests waiting." : "No waiting requests on this page. Check the other pages."}</p> : null}
    {items.map((order) => <article key={order.id} className="cf-qr-request">
      <div className="cf-billing-panel__heading"><div><h3>{order.table || "Table not recorded"} · {order.customer_name || "Guest"}</h3><p>{order.created_at ? `Order placed: ${new Date(order.created_at).toLocaleString()}` : "Order time not recorded"}</p></div><strong>{formatCurrency(order.total, currency)} <small>before invoice tax/discount</small></strong></div>
      <p>Loyalty points requested: {order.points_requested}. Balance is checked when issuing.</p>
      <div className="cf-billing-panel__actions"><button className="cf-btn cf-btn--primary" type="button" disabled={busy || loading || readFailed} onClick={() => issue(order)}>Issue unpaid bill</button>
      <button className="cf-btn cf-btn--secondary" type="button" disabled={busy || loading || readFailed} onClick={() => setAllocation({ id: order.id, epoch: generation.current, outlet: selectedOutletId })}>Combine rounds / split items</button>
      {order.points_requested > 0 ? <button className="cf-btn cf-btn--secondary" type="button" disabled={busy || loading || readFailed} onClick={() => issue(order, false)}>Issue without loyalty points</button> : null}</div>
    </article>)}
    {loaded && <nav className="cf-billing-panel__actions" aria-label="QR request pages"><button className="cf-btn cf-btn--secondary" disabled={busy || loading || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page}</span><button className="cf-btn cf-btn--secondary" disabled={busy || loading || !hasMore} onClick={() => setPage(n => n + 1)}>Next</button></nav>}
    </div>;
  if (compact) return <>
    <button type="button" className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => setExpanded(true)}>Guest bill requests{error ? ' · Needs attention' : loaded && items.length ? ` · ${items.length}${hasMore ? '+' : ''}` : ''}</button>
    <Dialog open={expanded} onOpenChange={value => { if (!busy) setExpanded(value); }}><DialogContent className="cf-guest-inbox-dialog" aria-describedby={descriptionId}><DialogHeader><DialogTitle>Guest bill requests</DialogTitle></DialogHeader>{content}</DialogContent></Dialog>
  </>;
  return <details className="cf-card cf-billing__support" aria-label="QR final bill requests" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>QR final bill requests · {error ? 'Needs attention' : !loaded ? 'Loading…' : `${items.length} on this page`}</summary>{content}
  </details>;
}
