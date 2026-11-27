import QRCode from "qrcode";
import jsQR from "jsqr";

// Branded QR codes drawn on the device as SVG. Scan safety: highest error correction (H, ~30% recoverable), a 4-module
// quiet zone, dark-on-light colours with contrast >= 4.5:1, a logo of at most 24% of the width, and finder patterns
// kept solid. Every design is then decoded with jsQR at print and small sizes before it may be saved or printed.

export const DEFAULT_DESIGN = { fg: "#111827", bg: "#ffffff", accent: "#111827", modules: "square", eyes: "square", frame: "card", cta: "Scan to see the menu & order", show_table: true, logo: null, logo_scale: 0.2 };
const QUIET = 4;

const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex) => { const n = parseInt(String(hex).slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
export const contrastRatio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** Same rule as the server: a reason the colours are unsafe, or "" when they are fine. */
export const colourProblem = (design) => {
  if (!/^#[0-9a-f]{6}$/i.test(design.fg) || !/^#[0-9a-f]{6}$/i.test(design.bg)) return "Choose both colours";
  if (luminance(design.fg) >= luminance(design.bg)) return "Use a dark code on a light background — many phone cameras cannot read light-on-dark codes.";
  if (contrastRatio(design.fg, design.bg) < 4.5) return `Contrast is ${contrastRatio(design.fg, design.bg).toFixed(1)}:1; it needs at least 4.5:1. Darken the code or lighten the background.`;
  return "";
};

const escapeXml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
const isFinder = (row, col, size) => (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);

function eye(x, y, style, fg, bg) {
  if (style === "circle") return `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="3.5" fill="${fg}"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="2.5" fill="${bg}"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${fg}"/>`;
  const [outer, middle, inner] = style === "rounded" ? [1.6, 1.1, 0.8] : [0, 0, 0];
  return `<rect x="${x}" y="${y}" width="7" height="7" rx="${outer}" fill="${fg}"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="${middle}" fill="${bg}"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${inner}" fill="${fg}"/>`;
}

/** The code itself as an SVG <g> in module units (size + 2 * QUIET square), plus its side length. */
export function qrSymbol(value, design = DEFAULT_DESIGN) {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "H" });
  const size = modules.size, side = size + QUIET * 2;
  const { fg, bg } = design;
  // The logo sits in a cleared, odd-sized centre square; error correction H restores the modules it hides.
  let logoCells = 0;
  if (design.logo) { logoCells = Math.floor(size * Math.min(0.24, Math.max(0.12, Number(design.logo_scale) || 0.2))); if (logoCells % 2 === 0) logoCells -= 1; }
  const logoStart = Math.floor((size - logoCells) / 2), inLogo = (row, col) => logoCells > 0 && row >= logoStart - 1 && row < logoStart + logoCells + 1 && col >= logoStart - 1 && col < logoStart + logoCells + 1;
  const cells = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!modules.get(row, col) || isFinder(row, col, size) || inLogo(row, col)) continue;
      const x = col + QUIET, y = row + QUIET;
      // Timing, alignment and format modules stay square: scanners locate and read the grid from them.
      if (modules.isReserved(row, col)) { cells.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`); continue; }
      cells.push(design.modules === "dots" ? `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.5"/>` : design.modules === "rounded" ? `<rect x="${x}" y="${y}" width="1.02" height="1.02" rx="0.28"/>` : `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`);
    }
  }
  const eyes = [[0, 0], [size - 7, 0], [0, size - 7]].map(([col, row]) => eye(col + QUIET, row + QUIET, design.eyes, fg, bg)).join("");
  const logo = logoCells ? `<rect x="${logoStart + QUIET - 0.5}" y="${logoStart + QUIET - 0.5}" width="${logoCells + 1}" height="${logoCells + 1}" rx="1" fill="${bg}"/><image href="${escapeXml(design.logo)}" x="${logoStart + QUIET}" y="${logoStart + QUIET}" width="${logoCells}" height="${logoCells}" preserveAspectRatio="xMidYMid meet"/>` : "";
  return { side, markup: `<rect width="${side}" height="${side}" fill="${bg}"/><g fill="${fg}">${cells.join("")}</g>${eyes}${logo}` };
}

/** A complete printable SVG: the code alone, with a label band, or as a card with the business and table names. */
export function renderQrSvg({ value, design = DEFAULT_DESIGN, title = "", subtitle = "" }) {
  const { side, markup } = qrSymbol(value, design);
  const qr = (x, y, width) => `<g transform="translate(${x} ${y}) scale(${width / side})">${markup}</g>`;
  const cta = escapeXml(design.cta || ""), sub = escapeXml(design.show_table === false ? "" : subtitle), name = escapeXml(title);
  const font = `font-family="Inter, 'Segoe UI', Arial, sans-serif"`;
  // Shrinks a line so it fits the printable width (average glyph is about 0.56 em).
  const fit = (textValue, max, width) => Math.max(18, Math.min(max, Math.floor(width / (0.56 * Math.max(1, String(textValue).length)))));
  if (design.frame === "none") return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side * 10}" height="${side * 10}">${markup}</svg>`;
  if (design.frame === "label") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 720" width="600" height="720"><rect width="600" height="720" fill="${design.bg}"/>${qr(0, 0, 600)}
<rect x="40" y="600" width="520" height="96" rx="48" fill="${design.accent}"/>
<text x="300" y="${sub ? 640 : 658}" text-anchor="middle" ${font} font-size="${fit(design.cta || "", sub ? 30 : 32, 480)}" font-weight="700" fill="${design.bg}">${cta}</text>
${sub ? `<text x="300" y="678" text-anchor="middle" ${font} font-size="${fit(subtitle, 24, 480)}" fill="${design.bg}">${sub}</text>` : ""}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 980" width="700" height="980"><rect width="700" height="980" rx="44" fill="${design.bg}"/>
<rect x="14" y="14" width="672" height="952" rx="34" fill="none" stroke="${design.accent}" stroke-width="4"/>
<text x="350" y="112" text-anchor="middle" ${font} font-size="${fit(title, 44, 600)}" font-weight="800" fill="${design.fg}">${name}</text>
${qr(70, 150, 560)}
<text x="350" y="790" text-anchor="middle" ${font} font-size="${fit(design.cta || "", 34, 600)}" font-weight="700" fill="${design.accent}">${cta}</text>
${sub ? `<text x="350" y="870" text-anchor="middle" ${font} font-size="${fit(subtitle, 64, 600)}" font-weight="800" fill="${design.fg}">${sub}</text>` : ""}</svg>`;
}

/** Draws an SVG onto a white canvas `width` pixels wide. */
export async function svgToCanvas(svg, width) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("The design could not be drawn")); img.src = url; });
    const ratio = (image.naturalHeight || image.height) / (image.naturalWidth || image.width) || 1;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = Math.round(width * ratio);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

/** Reads the canvas the way a phone camera would; returns the decoded text or null. */
export const decodeCanvas = (canvas) => {
  const context = canvas.getContext("2d");
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" })?.data ?? null;
};

/** Decodes the finished design at print size and at a small (far-away) size. ok only if both read back `value`. */
export async function verifyQrDesign({ value, design, title, subtitle }) {
  const problem = colourProblem(design);
  if (problem) return { ok: false, reason: problem };
  const svg = renderQrSvg({ value, design, title, subtitle });
  for (const width of [900, 360]) {
    const decoded = decodeCanvas(await svgToCanvas(svg, width));
    if (decoded !== value) return { ok: false, reason: decoded ? "The code reads a different address" : `The code did not scan at ${width === 900 ? "print" : "small"} size. Try square dots, a smaller logo or stronger colours.` };
  }
  return { ok: true, svg };
}

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const downloadSvg = (svg, filename) => downloadBlob(new Blob([svg], { type: "image/svg+xml" }), filename);
export async function downloadPng(svg, filename, width = 2400) {
  const canvas = await svgToCanvas(svg, width);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  downloadBlob(blob, filename);
}

/** Prints the verified designs: one A6 card per page, or six per A4 sticker sheet. */
export function printQrSheet(svgs, { layout = "cards" } = {}) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const css = layout === "stickers"
    ? "@page{size:A4;margin:10mm}body{margin:0;display:grid;grid-template-columns:repeat(2,1fr);gap:6mm}.item{height:88mm;display:flex;justify-content:center;break-inside:avoid}.item svg{height:100%;width:auto}"
    : "@page{size:105mm 148mm;margin:6mm}body{margin:0}.item{height:134mm;display:flex;justify-content:center;page-break-after:always}.item svg{height:100%;width:auto}";
  const doc = frame.contentDocument;
  doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR codes</title><style>${css}</style></head><body>${svgs.map((svg) => `<div class="item">${svg}</div>`).join("")}</body></html>`); doc.close();
  const view = frame.contentWindow;
  view.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500), { once: true });
  setTimeout(() => { view.focus(); view.print(); }, 300);
  setTimeout(() => frame.isConnected && frame.remove(), 120000);
}

/** Reads a chosen image file as a data URL after checking its type and size. */
export const readImageFile = (file, maxBytes) => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return reject(new Error("Choose a PNG, JPG or WebP image"));
  if (file.size > maxBytes) return reject(new Error(`Choose an image smaller than ${Math.round(maxBytes / 1000)} KB`));
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("The image could not be read"));
  reader.readAsDataURL(file);
});
