import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../lib/apiUrl";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { useActiveOutlet } from "../outlets/store/ActiveOutletContext";
import { readImageFile } from "./qrArt";

const EMPTY = { accent: "#b45309", welcome: "", logo: null, cover: null, featured: [], videos: [] };
const MAX_PICKS = 6, MAX_VIDEOS = 3;

/** Guest-menu look per outlet: logo, cover photo, accent, welcome line, chef's picks and YouTube/Vimeo videos. */
export function MenuBranding() {
  const { outlets = [], selectedOutletId } = useActiveOutlet();
  const [outletId, setOutletId] = useState(selectedOutletId || outlets[0]?.id || "");
  const [brand, setBrand] = useState(null);
  const [products, setProducts] = useState({ items: [], error: "" });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const request = useRef(0);
  useEffect(() => { if (!outletId && outlets[0]?.id) setOutletId(selectedOutletId || outlets[0].id); }, [outlets, selectedOutletId, outletId]);
  useEffect(() => {
    const ticket = ++request.current;
    setBrand(null); setDirty(false);
    axios.get(`${API_URL}/api/qr-studio/brand`, { params: outletId ? { outlet_id: outletId } : {}, withCredentials: true, skipCache: true })
      .then((response) => { if (ticket === request.current) setBrand({ ...EMPTY, ...apiData(response) }); })
      .catch((error) => { if (ticket === request.current) { setBrand({ ...EMPTY }); toast.error(getApiErrorMessage(error, "Branding could not be loaded")); } });
  }, [outletId]);
  useEffect(() => {
    axios.get(`${API_URL}/api/products`, { withCredentials: true }).then((response) => {
      const data = apiData(response);
      setProducts({ items: (Array.isArray(data) ? data : data?.items || []).filter((product) => product.active !== false).sort((a, b) => a.name.localeCompare(b.name)), error: "" });
    }).catch(() => setProducts({ items: [], error: "You need access to the menu to choose chef's picks." }));
  }, []);
  const update = (patch) => { setBrand((current) => ({ ...current, ...patch })); setDirty(true); };
  const switchOutlet = (next) => {
    if (dirty && !window.confirm("Discard unsaved branding changes for this outlet?")) return;
    setOutletId(next);
  };
  const image = (field, limit) => async (event) => {
    try { const value = await readImageFile(event.target.files?.[0], limit); if (value) update({ [field]: value }); }
    catch (error) { toast.error(error.message); }
    event.target.value = "";
  };
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const payload = { accent: brand.accent, welcome: brand.welcome, logo: brand.logo, cover: brand.cover, featured: brand.featured, videos: brand.videos.filter((video) => video.url.trim()) };
      setBrand({ ...EMPTY, ...apiData(await axios.put(`${API_URL}/api/qr-studio/brand`, payload, { params: outletId ? { outlet_id: outletId } : {}, withCredentials: true })) });
      setDirty(false); toast.success("Saved. Guests see the new look the next time they open the menu.");
    } catch (error) { toast.error(getApiErrorMessage(error, "Branding could not be saved")); }
    finally { setBusy(false); }
  };
  const togglePick = (id) => {
    const picks = brand.featured.includes(id) ? brand.featured.filter((pick) => pick !== id) : [...brand.featured, id];
    if (picks.length > MAX_PICKS) return toast.error(`Choose up to ${MAX_PICKS} chef's picks`);
    update({ featured: picks });
  };
  const productName = (id) => products.items.find((product) => product.id === id)?.name || "Menu item";

  return (
    <section className="cf-card cf-card--padded" style={{ marginBottom: 24 }} data-testid="menu-branding" aria-label="Guest menu branding">
      <div className="cf-card__title"><span>Guest menu look</span>{dirty ? <span className="cf-card__meta">Unsaved changes</span> : null}</div>
      <p className="cf-card__meta">What guests see after scanning: your logo, a cover photo, a welcome line, chef's picks and short videos. Videos play from YouTube or Vimeo; nothing is uploaded here.</p>
      {outlets.length > 1 ? <div className="cf-field" style={{ maxWidth: 320 }}>
        <label>Outlet</label>
        <select className="cf-select" aria-label="Branding outlet" value={outletId} onChange={(event) => switchOutlet(event.target.value)}>
          {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
        </select>
      </div> : null}
      {!brand ? <p role="status">Loading…</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24, alignItems: "start" }}>
          <form onSubmit={save} style={{ display: "grid", gap: 4 }} data-testid="branding-form">
            <div className="cf-field"><label>Accent colour</label><input type="color" aria-label="Accent colour" value={brand.accent} onChange={(event) => update({ accent: event.target.value })} style={{ width: 56, height: 32 }} /></div>
            <div className="cf-field"><label htmlFor="brand-welcome">Welcome line</label><input id="brand-welcome" className="cf-input" maxLength={140} placeholder="e.g. Fresh South Indian breakfasts since 1998" value={brand.welcome} onChange={(event) => update({ welcome: event.target.value })} /></div>
            {[["logo", "Logo", 200000], ["cover", "Cover photo (wide)", 500000]].map(([field, label, limit]) => (
              <div className="cf-field" key={field}>
                <label>{label}</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${label} file`} onChange={image(field, limit)} />
                  {brand[field] ? <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => update({ [field]: null })}>Remove</button> : null}
                </div>
                <span className="cf-card__meta">PNG, JPG or WebP under {limit / 1000} KB.</span>
              </div>
            ))}
            <div className="cf-field">
              <label>Chef's picks ({brand.featured.length}/{MAX_PICKS})</label>
              {products.error ? <span className="cf-card__meta">{products.error}</span> : (
                <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid var(--cf-border, #e5e7eb)", borderRadius: 8, padding: 8 }}>
                  {products.items.map((product) => <label key={product.id} style={{ display: "block" }}><input type="checkbox" checked={brand.featured.includes(product.id)} onChange={() => togglePick(product.id)} /> {product.name}</label>)}
                </div>
              )}
            </div>
            <div className="cf-field">
              <label>Videos ({brand.videos.length}/{MAX_VIDEOS})</label>
              {brand.videos.map((video, index) => (
                <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr auto", gap: 6, marginBottom: 6 }}>
                  <input className="cf-input" aria-label={`Video ${index + 1} title`} maxLength={60} placeholder="Meet the chef" value={video.title} onChange={(event) => update({ videos: brand.videos.map((item, at) => (at === index ? { ...item, title: event.target.value } : item)) })} />
                  <input className="cf-input" aria-label={`Video ${index + 1} link`} type="url" placeholder="https://youtu.be/…" value={video.url} onChange={(event) => update({ videos: brand.videos.map((item, at) => (at === index ? { ...item, url: event.target.value, embed_url: null } : item)) })} />
                  <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" aria-label={`Remove video ${index + 1}`} onClick={() => update({ videos: brand.videos.filter((_, at) => at !== index) })}>✕</button>
                </div>
              ))}
              {brand.videos.length < MAX_VIDEOS ? <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => update({ videos: [...brand.videos, { title: "", url: "" }] })}>Add a YouTube or Vimeo link</button> : null}
            </div>
            <button className="cf-btn cf-btn--primary" type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save menu look"}</button>
          </form>
          <div aria-label="Guest preview" data-testid="branding-preview" style={{ width: 300, justifySelf: "center", border: "8px solid #111827", borderRadius: 28, overflow: "hidden", background: "#fff" }}>
            <div style={{ height: 120, background: brand.cover ? `center / cover no-repeat url(${brand.cover})` : brand.accent, position: "relative" }}>
              {brand.logo ? <img alt="" src={brand.logo} style={{ position: "absolute", left: 14, bottom: -24, width: 56, height: 56, objectFit: "contain", background: "#fff", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,.2)" }} /> : null}
            </div>
            <div style={{ padding: "32px 14px 16px" }}>
              <strong style={{ fontSize: 17 }}>Your menu</strong>
              {brand.welcome ? <p style={{ margin: "4px 0 10px", color: "#4b5563", fontSize: 13 }}>{brand.welcome}</p> : null}
              {brand.featured.length ? <>
                <div style={{ fontSize: 12, fontWeight: 700, color: brand.accent, textTransform: "uppercase", letterSpacing: 0.5 }}>Chef's picks</div>
                <div style={{ display: "flex", gap: 8, overflow: "hidden", margin: "6px 0 12px" }}>
                  {brand.featured.map((id) => <span key={id} style={{ flex: "0 0 auto", border: `1px solid ${brand.accent}`, borderRadius: 999, padding: "4px 10px", fontSize: 12 }}>{productName(id)}</span>)}
                </div>
              </> : null}
              {brand.videos.filter((video) => video.url).map((video, index) => <div key={index} style={{ fontSize: 12, padding: "6px 8px", background: "#f3f4f6", borderRadius: 8, marginBottom: 6 }}>▶ {video.title || "Video"}</div>)}
              <div style={{ marginTop: 10, background: brand.accent, color: "#fff", borderRadius: 10, padding: "8px 10px", textAlign: "center", fontSize: 13, fontWeight: 700 }}>View cart</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
