import React, { useState } from "react";
import { ProductPhoto, resolveProductPhoto } from "./ProductPhoto";
import { formatCurrency } from "../lib/pos";

// The outlet's guest-menu look (QR Studio). Without saved branding the plain header is used unchanged.

export function QrBrandHeader({ brand, title, overline, detail }) {
  if (!brand) return null;
  return (
    <header className="cf-qr-header" data-testid="qr-brand-header" style={{ padding: 0, overflow: "hidden", display: "block" }}>
      <div style={{ height: brand.cover_url ? 150 : 72, background: brand.cover_url ? `center / cover no-repeat url("${resolveProductPhoto(brand.cover_url)}")` : brand.accent, position: "relative" }}>
        {brand.logo_url ? <img alt="" src={resolveProductPhoto(brand.logo_url)} style={{ position: "absolute", left: 16, bottom: -28, width: 64, height: 64, objectFit: "contain", background: "#fff", borderRadius: 16, boxShadow: "0 2px 10px rgba(0,0,0,.18)" }} /> : null}
      </div>
      <div style={{ padding: `${brand.logo_url ? 36 : 14}px 16px 14px` }}>
        {overline ? <div className="cf-page__overline" style={{ color: brand.accent }}>{overline}</div> : null}
        <h1 style={{ margin: "2px 0" }}>{title}</h1>
        {brand.welcome ? <p style={{ margin: "2px 0", color: "#4b5563" }}>{brand.welcome}</p> : null}
        {detail ? <p style={{ margin: "2px 0" }}>{detail}</p> : null}
      </div>
    </header>
  );
}

/** Chef's picks that are on the menu right now (sold-out or unavailable picks are left out). */
export function QrChefPicks({ brand, items, onOpen }) {
  const picks = (brand?.featured_ids || []).map((id) => items.find((item) => item.id === id)).filter(Boolean);
  if (!picks.length) return null;
  return (
    <section aria-label="Chef's picks" data-testid="qr-chef-picks" style={{ margin: "12px 14px" }}>
      <h2 style={{ color: brand.accent, fontSize: 15, textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 8px" }}>Chef's picks</h2>
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6, scrollSnapType: "x mandatory" }}>
        {picks.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpen?.(item)} aria-label={`${item.name}, ${formatCurrency(item.price)}`} style={{ flex: "0 0 140px", scrollSnapAlign: "start", textAlign: "left", border: "1px solid #e5e7eb", borderRadius: 14, padding: 8, background: "#fff", cursor: onOpen ? "pointer" : "default" }}>
            <ProductPhoto source={item.image_url} name={item.name} size={122} />
            <div style={{ fontWeight: 700, marginTop: 6, fontSize: 14 }}>{item.name}</div>
            <div style={{ fontSize: 13 }}>{Number(item.list_price) > Number(item.price) ? <><s style={{ color: "#6b7280" }}>{formatCurrency(item.list_price)}</s> </> : null}<strong>{formatCurrency(item.price)}</strong></div>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Videos load only when tapped, so the menu stays fast on mobile data. */
export function QrVideos({ brand }) {
  const [playing, setPlaying] = useState(null);
  const videos = brand?.videos || [];
  if (!videos.length) return null;
  return (
    <section aria-label="Videos" data-testid="qr-videos" style={{ margin: "12px 14px", display: "grid", gap: 8 }}>
      {videos.map((video, index) => playing === index ? (
        <div key={index} style={{ position: "relative", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "#000" }}>
          <iframe title={video.title || "Video"} src={`${video.embed_url}?autoplay=1&playsinline=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
        </div>
      ) : (
        <button key={index} type="button" onClick={() => setPlaying(index)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", textAlign: "left", cursor: "pointer" }}>
          <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 18, background: brand.accent, color: "#fff", display: "grid", placeItems: "center", fontSize: 14 }}>▶</span>
          <span style={{ fontWeight: 600 }}>{video.title || "Watch video"}</span>
        </button>
      ))}
    </section>
  );
}
