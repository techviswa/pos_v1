import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../../lib/apiUrl";
import { apiData } from "../../lib/apiData";
import { getApiErrorMessage } from "../../lib/apiErrors";
import { getPublicQrUrl } from "../../lib/qrUrls";
import { DEFAULT_DESIGN, colourProblem, contrastRatio, printQrSheet, readImageFile, verifyQrDesign } from "./qrArt";
import { DesignedQr } from "./DesignedQr";

const PALETTES = [
  { name: "Classic", fg: "#111827", bg: "#ffffff", accent: "#111827" },
  { name: "Espresso", fg: "#3b1f0e", bg: "#fff8f0", accent: "#b45309" },
  { name: "Garden", fg: "#14532d", bg: "#f7fdf8", accent: "#15803d" },
  { name: "Harbour", fg: "#0c2d48", bg: "#f5faff", accent: "#0369a1" },
  { name: "Berry", fg: "#4a0d2e", bg: "#fff7fb", accent: "#be185d" },
];
const FIELDS = ["fg", "bg", "accent", "modules", "eyes", "frame", "cta", "show_table", "logo", "logo_scale"];
const pickDesign = (value = {}) => Object.fromEntries(FIELDS.map((field) => [field, value[field] ?? DEFAULT_DESIGN[field]]));
const Choice = ({ label, value, options, onChange }) => (
  <div className="cf-field">
    <label>{label}</label>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => <button key={key} type="button" role="radio" aria-checked={value === key} className={`cf-btn cf-btn--small ${value === key ? "cf-btn--primary" : "cf-btn--secondary"}`} onClick={() => onChange(key)}>{text}</button>)}
    </div>
  </div>
);

/** Design & print: one look for every printed QR code, checked to scan before it can be saved or printed. */
export function QrDesigner({ tables = [], design, onSaved }) {
  const [draft, setDraft] = useState(() => pickDesign(design));
  const [dirty, setDirty] = useState(false);
  const [previewId, setPreviewId] = useState("");
  const [check, setCheck] = useState({ status: "checking" });
  const [busy, setBusy] = useState("");
  const [layout, setLayout] = useState("cards");
  // A refresh replaces the saved design but never discards edits in progress.
  useEffect(() => { if (!dirty) setDraft(pickDesign(design)); }, [design]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = useMemo(() => tables.filter((table) => table.qr_ordering?.active), [tables]);
  const preview = active.find((table) => table.id === previewId) || active[0] || null;
  const value = preview ? getPublicQrUrl(preview.qr_ordering.token) : getPublicQrUrl("preview");
  const businessName = design?.business_name || "";
  const subtitle = preview ? preview.name : "Table 1";
  const update = (patch) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true); };
  const draftKey = JSON.stringify(draft);
  useEffect(() => {
    let current = true;
    setCheck({ status: "checking" });
    const timer = setTimeout(() => verifyQrDesign({ value, design: draft, title: businessName, subtitle })
      .then((result) => { if (current) setCheck(result.ok ? { status: "ok" } : { status: "failed", reason: result.reason }); })
      .catch(() => { if (current) setCheck({ status: "failed", reason: "The code could not be drawn on this device." }); }), 250);
    return () => { current = false; clearTimeout(timer); };
  }, [draftKey, value, businessName, subtitle]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy("save");
    try {
      const saved = apiData(await axios.put(`${API_URL}/api/table-management/qr-design`, draft, { withCredentials: true }));
      setDirty(false); onSaved?.(saved); toast.success("QR design saved. Every table and smart code now prints in this design.");
    } catch (error) { toast.error(getApiErrorMessage(error, "The design could not be saved")); }
    finally { setBusy(""); }
  };
  const printAll = async () => {
    if (!active.length) return toast.error("Generate table QR codes first");
    setBusy("print");
    try {
      const svgs = [], failed = [];
      for (const table of active) {
        const result = await verifyQrDesign({ value: getPublicQrUrl(table.qr_ordering.token), design: draft, title: businessName, subtitle: table.name });
        if (result.ok) svgs.push(result.svg); else failed.push(table.name);
      }
      if (failed.length) toast.error(`Not printed — these codes did not scan: ${failed.join(", ")}. Adjust the design and try again.`);
      else { printQrSheet(svgs, { layout }); toast.success(`${svgs.length} codes checked and sent to the printer`); }
    } finally { setBusy(""); }
  };
  const chooseLogo = async (event) => {
    try { const logo = await readImageFile(event.target.files?.[0], 200000); if (logo) update({ logo }); }
    catch (error) { toast.error(error.message); }
    event.target.value = "";
  };
  const problem = colourProblem(draft);

  return (
    <section className="cf-card cf-card--padded" style={{ marginBottom: 24 }} data-testid="qr-designer" aria-label="QR design">
      <div className="cf-card__title"><span>Design & print</span>{dirty ? <span className="cf-card__meta">Unsaved changes</span> : null}</div>
      <p className="cf-card__meta">One look for every table card and smart code. Each design is test-scanned on this device at print size and at small size before it can be saved or printed.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div className="cf-field">
            <label>Palette</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PALETTES.map((palette) => <button key={palette.name} type="button" className="cf-btn cf-btn--secondary cf-btn--small" onClick={() => update({ fg: palette.fg, bg: palette.bg, accent: palette.accent })}>
                <span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, borderRadius: 6, background: palette.fg, border: `3px solid ${palette.accent}`, marginRight: 6 }} />{palette.name}</button>)}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[["fg", "Code"], ["bg", "Background"], ["accent", "Accent"]].map(([field, text]) => (
              <label key={field} className="cf-card__meta" style={{ display: "grid", gap: 4 }}>{text}
                <input type="color" aria-label={`${text} colour`} value={draft[field]} onChange={(event) => update({ [field]: event.target.value })} style={{ width: 56, height: 32 }} />
              </label>
            ))}
            <span className="cf-card__meta" style={{ alignSelf: "end" }} role="status">Contrast {contrastRatio(draft.fg, draft.bg).toFixed(1)}:1 {problem ? "" : "✓"}</span>
          </div>
          {problem ? <p role="alert" style={{ color: "var(--cf-red)" }}>{problem}</p> : null}
          <Choice label="Dots" value={draft.modules} onChange={(modules) => update({ modules })} options={[["square", "Square"], ["rounded", "Rounded"], ["dots", "Dots"]]} />
          <Choice label="Corners" value={draft.eyes} onChange={(eyes) => update({ eyes })} options={[["square", "Square"], ["rounded", "Rounded"], ["circle", "Circle"]]} />
          <Choice label="Frame" value={draft.frame} onChange={(frame) => update({ frame })} options={[["card", "Table card"], ["label", "Label"], ["none", "Code only"]]} />
          <div className="cf-field">
            <label htmlFor="qr-cta">Call to action</label>
            <input id="qr-cta" className="cf-input" maxLength={40} value={draft.cta} onChange={(event) => update({ cta: event.target.value })} />
          </div>
          <label className="cf-card__meta"><input type="checkbox" checked={draft.show_table} onChange={(event) => update({ show_table: event.target.checked })} /> Print the table name</label>
          <div className="cf-field">
            <label>Logo in the centre</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Logo file" onChange={chooseLogo} />
              {draft.logo ? <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => update({ logo: null })}>Remove logo</button> : null}
            </div>
            {draft.logo ? <label className="cf-card__meta" style={{ display: "grid", gap: 4, marginTop: 6 }}>Logo size {Math.round(draft.logo_scale * 100)}% of the width
              <input type="range" min="0.12" max="0.24" step="0.01" value={draft.logo_scale} onChange={(event) => update({ logo_scale: Number(event.target.value) })} />
            </label> : <span className="cf-card__meta">Square logos work best. PNG, JPG or WebP under 200 KB.</span>}
          </div>
        </div>
        <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
          {active.length > 1 ? <select className="cf-select" aria-label="Preview table" value={preview?.id || ""} onChange={(event) => setPreviewId(event.target.value)}>
            {active.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
          </select> : null}
          <DesignedQr value={value} design={draft} title={businessName} subtitle={subtitle} size={260} label={`Preview for ${subtitle}`} filename={`qr-${(preview?.code || preview?.name || "preview").toString().replace(/\W+/g, "-").toLowerCase()}`} showDownloads={Boolean(preview)} />
          <p role="status" data-testid="qr-scan-check" style={{ fontWeight: 600, color: check.status === "failed" ? "var(--cf-red)" : check.status === "ok" ? "var(--cf-green, #15803d)" : undefined }}>
            {check.status === "checking" ? "Test-scanning…" : check.status === "ok" ? "✓ Scans at print size and small size" : `✗ ${check.reason}`}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="cf-btn cf-btn--primary" type="button" disabled={busy !== "" || check.status !== "ok" || !dirty} onClick={save}>{busy === "save" ? "Saving…" : "Save design"}</button>
            <select className="cf-select" aria-label="Print layout" value={layout} onChange={(event) => setLayout(event.target.value)}>
              <option value="cards">A6 table cards (one per page)</option>
              <option value="stickers">A4 sticker sheet (6 per page)</option>
            </select>
            <button className="cf-btn cf-btn--secondary" type="button" disabled={busy !== "" || check.status !== "ok"} onClick={printAll}>{busy === "print" ? "Checking every code…" : `Print all ${active.length} table codes`}</button>
          </div>
          {!preview ? <p className="cf-card__meta">This preview uses a sample address. Generate table QR codes below to download or print real ones.</p> : null}
        </div>
      </div>
    </section>
  );
}
