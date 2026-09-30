import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import axios from "axios";
import { apiData } from "../lib/apiData";
import { toast } from "sonner";
import { Layout } from "../components/Layout";
import { ApiErrorPanel } from "../components/ApiErrorPanel";
import { API_URL, useAuth } from "../contexts/AuthContext";
import { useAutoRefresh } from "../hooks/useAutoRefresh";
import { getApiErrorMessage } from "../lib/apiErrors";
import { formatCurrency, newClientKey } from "../lib/pos";
import { useActiveOutlet } from "../core/outlets/store/ActiveOutletContext";
import { formatDateTime } from "../core/staff/staffTime";

const STATUS_BADGE = { active: "cf-badge--green", pending_payment: "cf-badge--amber", blocked: "cf-badge--gray", expired: "cf-badge--gray", void: "cf-badge--gray" };
const STATUS_LABEL = { active: "Active", pending_payment: "Payment not confirmed", blocked: "Blocked", expired: "Expired", void: "Void" };
const METHODS = ["Cash", "UPI", "Card"];
const emptySale = () => ({ amount: "", payment_method: "Cash", payment_reference: "", customer_phone: "", customer_name: "", recipient_name: "", recipient_phone: "", note: "", client_request_id: newClientKey() });

/** Sell gift cards, check balances, and manage cards (top up, block, confirm UPI/card payments, void). */
export const GiftCards = () => {
  const { user } = useAuth();
  const { selectedOutletId } = useActiveOutlet();
  const manager = ["Owner", "Manager"].includes(user?.role);
  const [cards, setCards] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [sale, setSale] = useState(null);
  const [soldCard, setSoldCard] = useState(null);
  const [detail, setDetail] = useState(null);
  const [topUp, setTopUp] = useState({ amount: "", payment_method: "Cash", payment_reference: "" });

  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const load = async () => {
    try {
      const [listResponse, summaryResponse] = await Promise.all([
        axios.get(`${API_URL}/api/customers/gift-cards?${query}`, { withCredentials: true, skipCache: true }),
        axios.get(`${API_URL}/api/customers/gift-cards/summary`, { withCredentials: true, skipCache: true }),
      ]);
      setCards(Array.isArray(apiData(listResponse)) ? apiData(listResponse) : []);
      setSummary(apiData(summaryResponse) || null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  };
  useAutoRefresh(load, { liveResources: ["gift_cards", "bills"], refreshOnFocus: true });
  const reloadForQuery = useEffectEvent(() => load());
  const lastQueryRef = useRef(query);
  useEffect(() => {
    if (lastQueryRef.current === query) return undefined;
    lastQueryRef.current = query;
    const timer = window.setTimeout(() => reloadForQuery(), 300);
    return () => window.clearTimeout(timer);
  }, [query, reloadForQuery]);

  const openCard = async (id) => {
    try {
      const response = await axios.get(`${API_URL}/api/customers/gift-cards/${id}`, { withCredentials: true, skipCache: true });
      setDetail(apiData(response) || null);
      setTopUp({ amount: "", payment_method: "Cash", payment_reference: "" });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not open the card"));
    }
  };

  const act = async (request, success, failure) => {
    try {
      await request();
      toast.success(success);
      await load();
      if (detail) await openCard(detail.id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, failure));
    }
  };

  const sell = async (event) => {
    event.preventDefault();
    try {
      const response = await axios.post(`${API_URL}/api/customers/gift-cards`, { ...sale, amount: Number(sale.amount), outlet_id: selectedOutletId || undefined }, { withCredentials: true });
      setSoldCard(apiData(response) || null);
      setSale(null);
      toast.success("Gift card sold");
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Could not sell the gift card"));
    }
  };

  const printCard = () => {
    const popup = window.open("", "_blank", "width=420,height=520");
    if (!popup) return;
    const doc = popup.document;
    doc.title = "Gift card";
    const box = doc.createElement("div");
    box.style.cssText = "font-family:sans-serif;border:2px dashed #333;padding:20px;margin:20px;text-align:center";
    const lines = [
      ["h2", "Gift Card"],
      ["p", soldCard.recipient_name ? `For ${soldCard.recipient_name}` : ""],
      ["h1", formatCurrency(soldCard.initial_value)],
      ["p", "Code"],
      ["h3", soldCard.code],
      ["p", soldCard.expires_at ? `Valid until ${new Date(soldCard.expires_at).toLocaleDateString("en-IN")}` : "No expiry"],
      ["small", "Show this code when paying. Keep it private: anyone with the code can use the balance."],
    ];
    for (const [tag, text] of lines) {
      if (!text) continue;
      const element = doc.createElement(tag);
      element.textContent = text;
      box.appendChild(element);
    }
    doc.body.appendChild(box);
    popup.print();
  };

  const prompted = (message) => window.prompt(message);

  return (
    <Layout title="Gift Cards">
      <div className="cf-page" data-testid="gift-cards-page">
        <div className="cf-page__header">
          <div>
            <h1>Gift Cards</h1>
            <p>Cards are paid for now and spent later like money. No GST is charged when a card is sold; the bill it pays is taxed as usual. Cards sold by UPI or card become usable once an Owner or Manager confirms the payment.</p>
          </div>
          <div className="cf-page__header-actions">
            <button className="cf-btn cf-btn--primary" type="button" onClick={() => { setSale(emptySale()); setSoldCard(null); }}>Sell a gift card</button>
          </div>
        </div>

        {loadError ? <ApiErrorPanel error={loadError} onRetry={load} /> : null}

        <div className="cf-metrics">
          <div className="cf-metric"><div className="cf-metric__label">Active cards</div><div className="cf-metric__value">{summary?.active_count ?? "-"}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Unspent balance (owed to guests)</div><div className="cf-metric__value">{formatCurrency(summary?.outstanding)}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Waiting for payment check</div><div className="cf-metric__value">{formatCurrency(summary?.pending_payment)}</div></div>
          <div className="cf-metric"><div className="cf-metric__label">Expired unspent</div><div className="cf-metric__value">{formatCurrency(summary?.expired_unspent)}</div></div>
        </div>

        {soldCard ? (
          <div className="cf-card cf-card--padded" role="status" style={{ marginTop: 12 }} data-testid="sold-card">
            <div className="cf-page__overline">Card sold: give this code to the customer. It is shown only now.</div>
            <h2 style={{ letterSpacing: 2, margin: "8px 0" }}>{soldCard.code}</h2>
            <p className="cf-card__meta">{formatCurrency(soldCard.initial_value)} · {STATUS_LABEL[soldCard.status]}{soldCard.expires_at ? ` · valid until ${formatDateTime(soldCard.expires_at)}` : ""}</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="cf-btn cf-btn--secondary" type="button" onClick={printCard}>Print</button>
              <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setSoldCard(null)}>Done</button>
            </div>
          </div>
        ) : null}

        {sale ? (
          <form className="cf-card cf-card--padded" onSubmit={sell} style={{ display: "grid", gap: 10, marginTop: 12 }} data-testid="sell-card-form">
            <strong>Sell a gift card</strong>
            <div className="cf-grid-2">
              <input aria-label="Card value" className="cf-input" min="1" placeholder="Value (₹)" required step="0.01" type="number" value={sale.amount} onChange={(event) => setSale({ ...sale, amount: event.target.value })} />
              <select aria-label="Paid by" className="cf-select" value={sale.payment_method} onChange={(event) => setSale({ ...sale, payment_method: event.target.value })}>
                {METHODS.map((method) => <option key={method}>{method}</option>)}
              </select>
              {sale.payment_method !== "Cash" ? (
                <input aria-label="Transaction reference" className="cf-input" placeholder="UPI/card transaction reference" required value={sale.payment_reference} onChange={(event) => setSale({ ...sale, payment_reference: event.target.value })} />
              ) : null}
              <input aria-label="Buyer phone" className="cf-input" inputMode="tel" placeholder="Buyer phone (optional)" value={sale.customer_phone} onChange={(event) => setSale({ ...sale, customer_phone: event.target.value })} />
              <input aria-label="Buyer name" className="cf-input" placeholder="Buyer name" value={sale.customer_name} onChange={(event) => setSale({ ...sale, customer_name: event.target.value })} />
              <input aria-label="Recipient name" className="cf-input" placeholder="For (recipient name)" value={sale.recipient_name} onChange={(event) => setSale({ ...sale, recipient_name: event.target.value })} />
              <input aria-label="Recipient phone" className="cf-input" inputMode="tel" placeholder="Recipient phone" value={sale.recipient_phone} onChange={(event) => setSale({ ...sale, recipient_phone: event.target.value })} />
              <input aria-label="Note" className="cf-input" placeholder="Note" value={sale.note} onChange={(event) => setSale({ ...sale, note: event.target.value })} />
            </div>
            <div className="cf-dialog-actions">
              <button className="cf-btn cf-btn--secondary" type="button" onClick={() => setSale(null)}>Cancel</button>
              <button className="cf-btn cf-btn--primary" disabled={user?.offline} type="submit">Sell card</button>
            </div>
          </form>
        ) : null}

        <div className="cf-card cf-card--padded" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <input aria-label="Search cards" className="cf-input" placeholder="Last 4 of the code, name or phone" style={{ flex: "2 1 200px" }} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <select aria-label="Status" className="cf-select" style={{ width: "auto" }} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">All cards</option>
            {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        <div className="cf-grid-2" style={{ alignItems: "start", marginTop: 12 }}>
          <div className="cf-card cf-card--padded" style={{ overflowX: "auto" }}>
            {cards.length ? (
              <table className="cf-table">
                <thead><tr><th>Card</th><th>Balance</th><th>Status</th><th>Sold</th></tr></thead>
                <tbody>
                  {cards.map((card) => (
                    <tr key={card.id} onClick={() => openCard(card.id)} style={{ cursor: "pointer" }}>
                      <td>{card.code}<div className="cf-card__meta">{card.recipient_name || card.customer_name || ""}</div></td>
                      <td>{formatCurrency(card.balance)} <span className="cf-card__meta">of {formatCurrency(card.initial_value)}</span></td>
                      <td><span className={`cf-badge ${STATUS_BADGE[card.status] || ""}`}>{STATUS_LABEL[card.status] || card.status}</span></td>
                      <td>{formatDateTime(card.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="cf-card__meta">No gift cards yet.</p>}
          </div>

          {detail ? (
            <div className="cf-card cf-card--padded" data-testid="card-detail">
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>{detail.code}</h2>
                <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => setDetail(null)}>Close</button>
              </div>
              <p className="cf-card__meta">
                {formatCurrency(detail.balance)} left of {formatCurrency(detail.initial_value)} · {STATUS_LABEL[detail.status]}
                {detail.expires_at ? ` · valid until ${formatDateTime(detail.expires_at)}` : ""}
                {detail.customer_name ? ` · bought by ${detail.customer_name}` : ""}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {detail.status === "pending_payment" && manager ? (
                  <button className="cf-btn cf-btn--primary cf-btn--small" type="button" onClick={() => {
                    const reference = prompted("Confirm the UPI/card payment was received. Reference:");
                    if (reference) act(() => axios.post(`${API_URL}/api/customers/gift-cards/${detail.id}/confirm-payment`, { reference }, { withCredentials: true }), "Payment confirmed", "Could not confirm");
                  }}>Confirm payment</button>
                ) : null}
                {detail.status === "active" ? (
                  <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                    const reason = prompted("Block this card (e.g. reported lost). Reason:");
                    if (reason) act(() => axios.post(`${API_URL}/api/customers/gift-cards/${detail.id}/block`, { reason }, { withCredentials: true }), "Card blocked", "Could not block");
                  }}>Block</button>
                ) : null}
                {detail.status === "blocked" ? (
                  <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                    const reason = prompted("Unblock this card. Reason:");
                    if (reason) act(() => axios.post(`${API_URL}/api/customers/gift-cards/${detail.id}/unblock`, { reason }, { withCredentials: true }), "Card unblocked", "Could not unblock");
                  }}>Unblock</button>
                ) : null}
                {manager && detail.status !== "void" ? (
                  <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => {
                    const reason = prompted(`Void this card${detail.balance > 0 && detail.status !== "pending_payment" ? ` and pay back ${formatCurrency(detail.balance)} in cash` : ""}? Reason:`);
                    if (reason) act(() => axios.post(`${API_URL}/api/customers/gift-cards/${detail.id}/void`, { reason, refund_method: "Cash" }, { withCredentials: true }), "Card voided", "Could not void");
                  }}>Void</button>
                ) : null}
              </div>
              {detail.status === "active" ? (
                <form style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }} onSubmit={(event) => {
                  event.preventDefault();
                  act(() => axios.post(`${API_URL}/api/customers/gift-cards/${detail.id}/reload`, { ...topUp, amount: Number(topUp.amount) }, { withCredentials: true }), "Card topped up", "Could not top up");
                }}>
                  <input aria-label="Top-up amount" className="cf-input" min="1" placeholder="Top up (₹)" required step="0.01" style={{ flex: "1 1 100px" }} type="number" value={topUp.amount} onChange={(event) => setTopUp({ ...topUp, amount: event.target.value })} />
                  <select aria-label="Top-up paid by" className="cf-select" style={{ flex: "1 1 90px" }} value={topUp.payment_method} onChange={(event) => setTopUp({ ...topUp, payment_method: event.target.value })}>
                    {(manager ? METHODS : ["Cash"]).map((method) => <option key={method}>{method}</option>)}
                  </select>
                  {topUp.payment_method !== "Cash" ? <input aria-label="Top-up reference" className="cf-input" placeholder="Reference" required style={{ flex: "1 1 120px" }} value={topUp.payment_reference} onChange={(event) => setTopUp({ ...topUp, payment_reference: event.target.value })} /> : null}
                  <button className="cf-btn cf-btn--secondary" type="submit">Top up</button>
                </form>
              ) : null}
              <div className="cf-page__overline" style={{ marginTop: 12 }}>History</div>
              <table className="cf-table">
                <tbody>
                  {(detail.transactions || []).map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>{row.type}{row.payment_method ? ` · ${row.payment_method}` : ""}{row.note ? <div className="cf-card__meta">{row.note}</div> : null}</td>
                      <td style={{ color: row.amount < 0 ? "var(--cf-red)" : undefined }}>{row.amount ? formatCurrency(row.amount) : ""}</td>
                      <td>{formatCurrency(row.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
};

export default GiftCards;
