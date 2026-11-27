import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_DESIGN, downloadPng, downloadSvg, verifyQrDesign } from "./qrArt";

const svgSrc = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** A code in the business's saved design, shown and downloadable only after it decoded correctly. */
export function DesignedQr({ value, design = DEFAULT_DESIGN, title = "", subtitle = "", filename = "qr-code", size = 160, label = "QR code", showDownloads = true }) {
  const [state, setState] = useState({ status: "checking" });
  const designKey = JSON.stringify(design);
  useEffect(() => {
    let active = true;
    setState({ status: "checking" });
    verifyQrDesign({ value, design, title, subtitle })
      .then((result) => { if (active) setState(result.ok ? { status: "ok", svg: result.svg } : { status: "failed", reason: result.reason }); })
      .catch(() => { if (active) setState({ status: "failed", reason: "The code could not be drawn on this device." }); });
    return () => { active = false; };
  }, [value, designKey, title, subtitle]); // eslint-disable-line react-hooks/exhaustive-deps
  if (state.status === "checking") return <p role="status" className="cf-card__meta">Checking the code scans…</p>;
  if (state.status === "failed") return <p role="alert" style={{ color: "var(--cf-red)" }}>{state.reason}</p>;
  const save = async (kind) => {
    try { if (kind === "svg") downloadSvg(state.svg, `${filename}.svg`); else await downloadPng(state.svg, `${filename}.png`); }
    catch { toast.error("The image could not be prepared. Try again."); }
  };
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
      <img alt={label} src={svgSrc(state.svg)} style={{ width: size, maxWidth: "100%", height: "auto" }} data-testid="designed-qr" />
      {showDownloads ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => save("png")}>PNG</button>
        <button className="cf-btn cf-btn--secondary cf-btn--small" type="button" onClick={() => save("svg")}>SVG</button>
      </div> : null}
    </div>
  );
}
