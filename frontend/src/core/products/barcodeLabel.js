// EAN-13 drawn on the device (no outside service) and printed as a small shelf/pack label.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export const isEan13 = (code) => {
  if (!/^\d{13}$/.test(String(code || ""))) return false;
  const digits = [...code].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
};

/** The 95 bars (1 = black) of an EAN-13 code. */
export const ean13Bits = (code) => {
  if (!isEan13(code)) throw new Error("Not a valid EAN-13 code");
  const digits = [...code].map(Number);
  const parity = PARITY[digits[0]];
  const left = digits.slice(1, 7).map((digit, index) => (parity[index] === "L" ? L : G)[digit]).join("");
  const right = digits.slice(7).map((digit) => R[digit]).join("");
  return `101${left}01010${right}101`;
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

/** SVG markup for the code; null when the code is not EAN-13 (such codes print as text only). */
export const ean13Svg = (code, { height = 40 } = {}) => {
  if (!isEan13(code)) return null;
  const bars = [...ean13Bits(code)].map((bit, index) => (bit === "1" ? `<rect x="${index + 9}" y="0" width="1" height="${height}"/>` : "")).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 113 ${height + 12}" width="100%" role="img" aria-label="Barcode ${code}"><g fill="#000">${bars}</g><text x="56.5" y="${height + 10}" font-family="monospace" font-size="9" text-anchor="middle">${code}</text></svg>`;
};

export const buildLabelHtml = ({ name, price, code, copies = 1 }) => {
  const svg = ean13Svg(code);
  const label = `<div class="label"><div class="name">${escapeHtml(name)}</div>${svg || `<div class="code">${escapeHtml(code)}</div>`}${price != null ? `<div class="price">${escapeHtml(price)}</div>` : ""}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Label ${escapeHtml(code)}</title><style>
  @page { size: 50mm 25mm; margin: 1mm; }
  body { margin: 0; font: 9px/1.2 Arial, sans-serif; }
  .label { width: 48mm; height: 23mm; overflow: hidden; text-align: center; page-break-after: always; }
  .name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .price { font-weight: 700; font-size: 10px; }
  .code { font: 12px monospace; margin: 6px 0; }
</style></head><body>${Array.from({ length: Math.max(1, Math.min(100, Number(copies) || 1)) }, () => label).join("")}</body></html>`;
};

export const printLabels = (options) => {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open(); doc.write(buildLabelHtml(options)); doc.close();
  const view = frame.contentWindow;
  view.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500), { once: true });
  view.focus();
  view.print();
  setTimeout(() => frame.isConnected && frame.remove(), 60000);
};
