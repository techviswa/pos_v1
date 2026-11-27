import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { resolveQrApiBaseUrl } from "../lib/qrUrls";
import { formatCurrency } from "../lib/pos";
import { ProductPhoto } from "../components/ProductPhoto";
import { QrBrandHeader, QrChefPicks, QrVideos } from "../components/QrBrand";
import { buildVCard } from "../lib/vcard";

const API_URL = resolveQrApiBaseUrl(process.env.REACT_APP_BACKEND_URL);
const unwrap = (response) => response?.data?.data ?? response?.data;
const digits = (value) => String(value || "").replace(/\D/g, "");

function MenuList({ items }) {
  const grouped = useMemo(() => items.reduce((groups, item) => ({ ...groups, [item.category || "Menu"]: [...(groups[item.category || "Menu"] || []), item] }), {}), [items]);
  if (!items.length) return <p>Nothing is available right now. Please ask our staff.</p>;
  return Object.entries(grouped).map(([category, rows]) => (
    <section className="cf-qr-category" key={category}>
      <h2>{category}</h2>
      {rows.map((item) => {
        const soldOut = item.qr_availability?.available === false;
        return (
          <div className="cf-qr-menu-item" key={item.id} style={{ opacity: soldOut ? 0.6 : 1 }}>
            <div className="cf-qr-menu-item__summary" style={{ display: "flex", gap: 12 }}>
              <ProductPhoto source={item.image_url} name={item.name} size={72} />
              <div>
                <strong>{item.name}</strong>{item.dietary_type ? <span className="cf-card__meta"> · {item.dietary_type}</span> : null}
                {item.description ? <p className="cf-qr-menu-item__description">{item.description}</p> : null}
                <div>{Number(item.list_price) > Number(item.price) ? <><s>{formatCurrency(item.list_price)}</s> </> : null}<strong>{formatCurrency(item.price)}</strong>{soldOut ? " · Sold out" : ""}</div>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  ));
}

/** What a smart code opens: a browse menu, an offer, a contact card, or a redirect to a review page / web link. */
export function QrLanding() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  useEffect(() => {
    let active = true;
    axios.get(`${API_URL}/api/public/qr-studio/links/${encodeURIComponent(token)}`)
      .then((response) => { if (active) setState({ loading: false, data: unwrap(response), error: "" }); })
      .catch((error) => { if (active) setState({ loading: false, data: null, error: error.response?.data?.error?.message || error.response?.data?.message || "This QR code could not be opened. Please try again." }); });
    return () => { active = false; };
  }, [token]);
  const data = state.data;
  // Review pages and web links: the scan is already recorded, so continue straight to the destination.
  useEffect(() => {
    if (!data?.url) return undefined;
    const timer = setTimeout(() => window.location.replace(data.url), 900);
    return () => clearTimeout(timer);
  }, [data]);

  if (state.loading) return <div className="cf-qr-page"><div className="cf-qr-shell"><p role="status">Opening…</p></div></div>;
  if (state.error) return <div className="cf-qr-page"><div className="cf-qr-shell"><div className="cf-qr-error" role="alert">{state.error}</div></div></div>;
  const brand = data.brand;
  const title = data.business?.name || "Welcome";
  const header = brand ? <QrBrandHeader brand={brand} title={title} overline={data.outlet?.name} /> : (
    <header className="cf-qr-header"><div>{data.outlet?.name ? <div className="cf-page__overline">{data.outlet.name}</div> : null}<h1>{title}</h1></div></header>
  );
  const accent = brand?.accent || "#111827";
  let host = "";
  try { host = data.url ? new URL(data.url).hostname : ""; } catch { host = ""; }

  return (
    <div className="cf-qr-page" data-testid={`qr-landing-${data.kind}`}>
      <div className="cf-qr-shell">
        {header}
        {data.headline ? <p style={{ fontSize: 18, fontWeight: 600 }}>{data.headline}</p> : null}
        {data.url ? (
          <section className="cf-qr-cart">
            <p>Taking you to {host}…</p>
            <a className="cf-btn cf-btn--primary" href={data.url} rel="noreferrer" style={{ background: accent, borderColor: accent }}>{data.kind === "review" ? "Leave a review" : "Continue"}</a>
          </section>
        ) : null}
        {data.card ? (
          <section className="cf-qr-cart" data-testid="qr-contact-card" style={{ display: "grid", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{data.card.title}</h2>
            {data.card.subtitle ? <p style={{ margin: 0, color: "#4b5563" }}>{data.card.subtitle}</p> : null}
            <div style={{ display: "grid", gap: 6 }}>
              {data.card.phone ? <a className="cf-btn cf-btn--secondary" href={`tel:${data.card.phone.replace(/[^+\d]/g, "")}`}>Call {data.card.phone}</a> : null}
              {data.card.whatsapp ? <a className="cf-btn cf-btn--secondary" href={`https://wa.me/${digits(data.card.whatsapp)}`} rel="noreferrer">WhatsApp</a> : null}
              {data.card.email ? <a className="cf-btn cf-btn--secondary" href={`mailto:${data.card.email}`}>Email {data.card.email}</a> : null}
              {data.card.website ? <a className="cf-btn cf-btn--secondary" href={data.card.website} rel="noreferrer">Website</a> : null}
              {data.card.instagram ? <a className="cf-btn cf-btn--secondary" href={`https://instagram.com/${data.card.instagram}`} rel="noreferrer">Instagram @{data.card.instagram}</a> : null}
              {data.card.address ? <a className="cf-btn cf-btn--secondary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.card.address)}`} rel="noreferrer">{data.card.address}</a> : null}
            </div>
            <a className="cf-btn cf-btn--primary" style={{ background: accent, borderColor: accent }} download={`${data.card.title.replace(/\W+/g, "-") || "contact"}.vcf`} href={`data:text/vcard;charset=utf-8,${encodeURIComponent(buildVCard(data.card))}`}>Save to contacts</a>
          </section>
        ) : null}
        {data.offer ? (
          <section className="cf-qr-cart" data-testid="qr-offer" style={{ borderColor: accent }}>
            <div className="cf-page__overline" style={{ color: accent }}>{data.offer.active_now ? "On now" : "Not on right now"}</div>
            <h2 style={{ margin: "2px 0" }}>{data.offer.name}: {data.offer.deal}</h2>
            <p style={{ margin: 0 }}>{data.offer.days} · {data.offer.hours}{data.offer.valid_to ? ` · until ${data.offer.valid_to}` : ""}</p>
          </section>
        ) : null}
        {data.unavailable ? <div className="cf-qr-error" role="status">{data.unavailable}</div> : null}
        {data.items ? <>
          {data.kind === "menu" ? <p className="cf-card__meta">Browse our menu. To order, ask our staff or scan the code on your table.</p> : null}
          <QrChefPicks brand={brand} items={data.items} />
          <QrVideos brand={brand} />
          <main className="cf-qr-menu"><MenuList items={data.items} /></main>
        </> : null}
        {!data.items && !data.url ? <QrVideos brand={brand} /> : null}
      </div>
    </div>
  );
}
