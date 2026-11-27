import { TextEncoder } from "util";
// jsdom lacks TextEncoder (every browser has it); the qrcode library needs it.
global.TextEncoder = global.TextEncoder || TextEncoder;
import { DEFAULT_DESIGN, colourProblem, contrastRatio, qrSymbol, renderQrSvg } from "./qrArt";
import { buildVCard } from "../../lib/vcard";
import { getSmartQrUrl } from "../../lib/qrUrls";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

test("colours follow the server rule: dark on light with contrast 4.5:1", () => {
  expect(colourProblem(DEFAULT_DESIGN)).toBe("");
  expect(colourProblem({ ...DEFAULT_DESIGN, fg: "#ffffff", bg: "#000000" })).toMatch(/dark code on a light background/);
  expect(colourProblem({ ...DEFAULT_DESIGN, fg: "#9ca3af" })).toMatch(/needs at least 4.5:1/);
  expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
});

test("the symbol keeps a 4-module quiet zone, solid finder eyes and a small cleared logo area", () => {
  const plain = qrSymbol("https://pos.example/qr/abc", DEFAULT_DESIGN);
  const withLogo = qrSymbol("https://pos.example/qr/abc", { ...DEFAULT_DESIGN, logo: LOGO, logo_scale: 0.24 });
  expect(plain.side % 1).toBe(0);
  expect(plain.markup).toContain(`<rect width="${plain.side}" height="${plain.side}"`);
  expect((plain.markup.match(/width="7" height="7"/g) || []).length).toBe(3);
  const cells = (markup) => (markup.match(/<rect x="[\d.]+" y="[\d.]+" width="1.02"/g) || []).length;
  expect(cells(withLogo.markup)).toBeLessThan(cells(plain.markup));
  // The hidden area stays under a third of what error correction H can restore (about 30% of the code).
  expect((cells(plain.markup) - cells(withLogo.markup)) / cells(plain.markup)).toBeLessThan(0.15);
  expect(withLogo.markup).toContain(`href="${LOGO}"`);
});

test("printed text is escaped and long lines shrink to fit", () => {
  const svg = renderQrSvg({ value: "https://pos.example/qr/abc", design: { ...DEFAULT_DESIGN, cta: "Scan <now> & order" }, title: "Bheema's Cafe", subtitle: "A very long table name for the terrace" });
  expect(svg).toContain("Scan &lt;now&gt; &amp; order");
  expect(svg).toContain("Bheema&apos;s Cafe");
  const size = Number(svg.match(/font-size="(\d+)" font-weight="800" fill="#111827">A very long/)[1]);
  expect(size).toBeLessThan(64);
  expect(renderQrSvg({ value: "x", design: { ...DEFAULT_DESIGN, show_table: false }, subtitle: "T1" })).not.toContain(">T1<");
});

test("smart codes print /q/<token> and contact cards save as vCards", () => {
  expect(getSmartQrUrl("Ab12", "https://pos.example")).toBe("https://pos.example/q/Ab12");
  const card = buildVCard({ title: "Asha; Owner", phone: "+91 98765 43210", instagram: "bheemas" });
  expect(card).toContain("FN:Asha\\; Owner");
  expect(card).toContain("TEL;TYPE=CELL:+91 98765 43210");
  expect(card.startsWith("BEGIN:VCARD") && card.endsWith("END:VCARD")).toBe(true);
});
