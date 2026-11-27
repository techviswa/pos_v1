import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../lib/apiUrl";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { getSmartQrUrl } from "../../lib/qrUrls";
import { useActiveOutlet } from "../outlets/store/ActiveOutletContext";
import { DesignedQr } from "./DesignedQr";

export const KIND_LABELS = { menu: "Browse menu", offer: "Offer", review: "Review", card: "Contact card", link: "Web link" };
const KIND_HELP = {
  menu: "A menu to browse at the counter, entrance or on takeaway bags. Guests order with staff; table codes are for ordering.",
  offer: "Shows one of your offers (Menu › Offers & happy hours) with the items and prices it covers.",
  review: "Sends guests to your Google, Zomato or other review page.",
  card: "A digital business card guests can save to their phone contacts.",
  link: "Any web page: Instagram, a booking form, an event page.",
};
const blank = (kind = "menu", outletId = "") => ({ id: null, name: "", kind, active: true, config: { outlet_id: outletId, headline: "" } });
const Field = ({ label, children }) => <div className="cf-field"><label>{label}</label>{children}</div>;

/** Smart codes (plan feature): permanent printed codes whose destination can be changed without reprinting. */
export function SmartCodes({ design }) {
  const { outlets = [], selectedOutletId } = useActiveOutlet();
  const [links, setLinks] = useState(null);
  const [rules, setRules] = useState({ items: [], error: "" });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const load = async () => {
    try { setLinks(apiData(await axios.get(`${API_URL}/api/qr-studio/links`, { withCredentials: true, skipCache: true })) || []); }
    catch (error) { setLinks([]); toast.error(getApiErrorMessage(error, "Smart codes could not be loaded")); }
  };
  useEffect(() => {
    void load();
    axios.get(`${API_URL}/api/price-rules`, { withCredentials: true }).then((response) => {
      const data = apiData(response);
      setRules({ items: (Array.isArray(data) ? data : data?.items || []).filter((rule) => rule.active), error: "" });
    }).catch(() => setRules({ items: [], error: "You need access to Offers to choose one." }));
  }, []);
  const open = (next) => {
    if (dirty.current && !window.confirm("Discard the unsaved changes to this code?")) return;
    dirty.current = false; setForm(next);
  };
  const change = (patch, config) => { dirty.current = true; setForm((current) => ({ ...current, ...patch, config: { ...current.config, ...(config || {}) } })); };
  const save = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const payload = { name: form.name, config: form.config };
      const saved = apiData(form.id
        ? await axios.put(`${API_URL}/api/qr-studio/links/${form.id}`, payload, { withCredentials: true })
        : await axios.post(`${API_URL}/api/qr-studio/links`, { ...payload, kind: form.kind }, { withCredentials: true }));
      dirty.current = false;
      toast.success(form.id ? "Saved. Printed copies now open the new destination." : "Smart code created");
      setForm({ ...saved, config: { ...saved.config, outlet_id: saved.outlet_id || "" } });
      await load();
    } catch (error) { toast.error(getApiErrorMessage(error, "The code could not be saved")); }
    finally { setBusy(false); }
  };
  const toggle = async (link) => {
    if (link.active && !window.confirm(`Switch off "${link.name}"? Printed copies will show "no longer active" until you switch it on again.`)) return;
    try {
      const saved = apiData(await axios.put(`${API_URL}/api/qr-studio/links/${link.id}`, { active: !link.active }, { withCredentials: true }));
      toast.success(saved.active ? "Code switched on" : "Code switched off");
      if (form?.id === link.id) setForm((current) => ({ ...current, active: saved.active }));
      await load();
    } catch (error) { toast.error(getApiErrorMessage(error, "The code could not be changed")); }
  };
  const c = form?.config || {};
  const outletName = (id) => outlets.find((outlet) => outlet.id === id)?.name || "";

  return (
    <section className="cf-card cf-card--padded" style={{ marginBottom: 24 }} data-testid="smart-codes" aria-label="Smart codes">
      <div className="cf-card__title"><span>Smart codes</span>
        <button className="cf-btn cf-btn--primary cf-btn--small" type="button" onClick={() => open(blank("menu", selectedOutletId || (outlets.length === 1 ? outlets[0].id : "")))}>New smart code</button>
      </div>
      <p className="cf-card__meta">Codes for posters, counters, bags and cards. The printed code never changes; you can change where it leads, or switch it off, at any time.</p>
      <div style={{ display: "grid", gridTemplateColumns: form ? "minmax(260px, 1fr) minmax(300px, 1.2fr)" : "1fr", gap: 20, alignItems: "start" }}>
        <div className="cf-table-wrap">
          <table className="cf-table">
            <thead><tr><th>Code</th><th>Type</th><th>Scans (30 days)</th><th>Status</th></tr></thead>
            <tbody>
              {(links || []).map((link) => (
                <tr key={link.id} aria-selected={form?.id === link.id} style={{ cursor: "pointer", background: form?.id === link.id ? "var(--cf-surface-2, #f3f4f6)" : undefined }} onClick={() => open({ ...link, config: { ...link.config, outlet_id: link.outlet_id || "" } })}>
                  <td><strong>{link.name}</strong>{link.outlet_id ? <div className="cf-card__meta">{outletName(link.outlet_id)}</div> : null}</td>
                  <td>{KIND_LABELS[link.kind]}</td>
                  <td className="cf-table__mono">{link.scans_30d} <span className="cf-card__meta">({link.scan_count} total)</span></td>
                  <td>{link.active ? "On" : "Off"}</td>
                </tr>
              ))}
              {links && !links.length ? <tr><td colSpan="4">No smart codes yet. Create one for your counter, a poster or your reviews.</td></tr> : null}
              {!links ? <tr><td colSpan="4">Loading…</td></tr> : null}
            </tbody>
          </table>
        </div>
        {form ? (
          <form onSubmit={save} data-testid="smart-code-form" style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>{form.id ? form.name : "New smart code"}</strong>
              <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => open(null)}>Close</button>
            </div>
            {!form.id ? <Field label="Type">
              <select className="cf-select" aria-label="Code type" value={form.kind} onChange={(event) => change({ kind: event.target.value })}>
                {Object.entries(KIND_LABELS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              </select>
            </Field> : <p className="cf-card__meta">{KIND_LABELS[form.kind]} · the type of a printed code cannot change.</p>}
            <p className="cf-card__meta">{KIND_HELP[form.kind]}</p>
            <Field label="Name (for you)"><input className="cf-input" aria-label="Code name" required maxLength={60} placeholder="e.g. Counter poster" value={form.name} onChange={(event) => change({ name: event.target.value })} /></Field>
            {["menu", "offer"].includes(form.kind) || outlets.length > 1 ? <Field label="Outlet">
              <select className="cf-select" aria-label="Outlet" required={["menu", "offer"].includes(form.kind) && outlets.length > 1} value={c.outlet_id || ""} onChange={(event) => change({}, { outlet_id: event.target.value })}>
                <option value="">{["menu", "offer"].includes(form.kind) ? "Choose outlet" : "Whole business"}</option>
                {outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
              </select>
            </Field> : null}
            {form.kind === "offer" ? <Field label="Offer">
              <select className="cf-select" aria-label="Offer" required value={c.rule_id || ""} onChange={(event) => change({}, { rule_id: event.target.value })}>
                <option value="">Choose an active offer</option>
                {rules.items.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
              </select>
              {rules.error ? <span className="cf-card__meta">{rules.error}</span> : !rules.items.length ? <span className="cf-card__meta">No active offers. Create one in Menu › Offers & happy hours.</span> : null}
            </Field> : null}
            {["review", "link"].includes(form.kind) ? <Field label={form.kind === "review" ? "Review page address" : "Web address"}>
              <input className="cf-input" aria-label="Destination address" type="url" required placeholder="https://" value={c.url || ""} onChange={(event) => change({}, { url: event.target.value })} />
            </Field> : null}
            {form.kind === "card" ? <>
              <Field label="Name on the card"><input className="cf-input" aria-label="Card name" required maxLength={60} value={c.title || ""} onChange={(event) => change({}, { title: event.target.value })} /></Field>
              <Field label="Role or tagline"><input className="cf-input" aria-label="Card tagline" maxLength={80} value={c.subtitle || ""} onChange={(event) => change({}, { subtitle: event.target.value })} /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Field label="Phone"><input className="cf-input" aria-label="Card phone" maxLength={20} value={c.phone || ""} onChange={(event) => change({}, { phone: event.target.value })} /></Field>
                <Field label="WhatsApp"><input className="cf-input" aria-label="Card WhatsApp" maxLength={20} value={c.whatsapp || ""} onChange={(event) => change({}, { whatsapp: event.target.value })} /></Field>
                <Field label="Email"><input className="cf-input" aria-label="Card email" type="email" maxLength={120} value={c.email || ""} onChange={(event) => change({}, { email: event.target.value })} /></Field>
                <Field label="Instagram"><input className="cf-input" aria-label="Card Instagram" maxLength={31} placeholder="@handle" value={c.instagram || ""} onChange={(event) => change({}, { instagram: event.target.value })} /></Field>
              </div>
              <Field label="Website"><input className="cf-input" aria-label="Card website" type="url" placeholder="https://" value={c.website || ""} onChange={(event) => change({}, { website: event.target.value })} /></Field>
              <Field label="Address"><input className="cf-input" aria-label="Card address" maxLength={160} value={c.address || ""} onChange={(event) => change({}, { address: event.target.value })} /></Field>
            </> : null}
            <Field label="Headline guests see (optional)"><input className="cf-input" aria-label="Headline" maxLength={80} value={c.headline || ""} onChange={(event) => change({}, { headline: event.target.value })} /></Field>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="cf-btn cf-btn--primary" type="submit" disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Create code"}</button>
              {form.id ? <button className="cf-btn cf-btn--secondary" type="button" onClick={() => toggle(form)}>{form.active ? "Switch off" : "Switch on"}</button> : null}
              {form.id && form.active ? <a className="cf-btn cf-btn--secondary" href={getSmartQrUrl(form.token)} target="_blank" rel="noreferrer">Open as a guest</a> : null}
            </div>
            {form.id && form.active ? <div style={{ marginTop: 12 }}>
              <DesignedQr value={getSmartQrUrl(form.token)} design={design} title={design?.business_name || ""} subtitle={c.headline || ""} size={220} filename={`qr-${form.name.replace(/\W+/g, "-").toLowerCase()}`} label={`QR code for ${form.name}`} />
              <p className="cf-card__meta" style={{ textAlign: "center" }}>Printed in your saved design (Design &amp; print), with the headline under the code. Test-scanned before download.</p>
            </div> : null}
          </form>
        ) : null}
      </div>
    </section>
  );
}
