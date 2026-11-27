import prisma from "../../../database/prisma/client.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { validateProductImage } from "../../../core/products/product-images.js";

// One printed look for every QR code of a business. The server refuses designs phones may fail to read:
// dark code on a light background, with enough contrast; the logo stays small enough for error correction (H) to
// recover the modules it covers. The device additionally decodes every rendered code before it can be printed.

export const MODULE_STYLES = ["square", "rounded", "dots"];
export const EYE_STYLES = ["square", "rounded", "circle"];
export const FRAME_STYLES = ["none", "label", "card"];
export const DEFAULT_DESIGN = Object.freeze({
  fg: "#111827", bg: "#ffffff", accent: "#111827", modules: "square", eyes: "square", frame: "card",
  cta: "Scan to see the menu & order", show_table: true, logo: null, logo_scale: 0.2,
});
const MIN_CONTRAST = 4.5;
const LOGO_LIMIT = 200000;
const key = (businessId) => `qr-design:${businessId}`;
const fail = (message) => { throw createHttpError({ statusCode: 400, code: "QR_DESIGN_INVALID", message }); };

const HEX = /^#[0-9a-f]{6}$/i;
const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
export const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

export function validateDesign(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Send the design as an object");
  const design = { ...DEFAULT_DESIGN };
  for (const field of ["fg", "bg", "accent"]) {
    if (input[field] === undefined) continue;
    if (typeof input[field] !== "string" || !HEX.test(input[field])) fail("Colours must be written like #1a2b3c");
    design[field] = input[field].toLowerCase();
  }
  if (luminance(design.fg) >= luminance(design.bg)) fail("Use a dark code on a light background. Many phone cameras cannot read light-on-dark codes.");
  if (contrastRatio(design.fg, design.bg) < MIN_CONTRAST) fail(`The code colour and background are too close (needs contrast ${MIN_CONTRAST}:1). Choose a darker code or a lighter background.`);
  const pick = (field, allowed) => {
    if (input[field] === undefined) return;
    if (!allowed.includes(input[field])) fail(`Choose one of: ${allowed.join(", ")}`);
    design[field] = input[field];
  };
  pick("modules", MODULE_STYLES); pick("eyes", EYE_STYLES); pick("frame", FRAME_STYLES);
  if (input.cta !== undefined) {
    if (typeof input.cta !== "string" || input.cta.trim().length > 40) fail("Keep the call to action within 40 characters");
    design.cta = input.cta.trim();
  }
  if (input.show_table !== undefined) design.show_table = input.show_table === true;
  if (input.logo_scale !== undefined) {
    const scale = Number(input.logo_scale);
    if (!Number.isFinite(scale) || scale < 0.12 || scale > 0.24) fail("The logo can cover between 12% and 24% of the code width");
    design.logo_scale = Math.round(scale * 100) / 100;
  }
  if (input.logo !== undefined && input.logo !== null && input.logo !== "") {
    if (typeof input.logo !== "string" || !input.logo.startsWith("data:") || input.logo.length > LOGO_LIMIT * 1.4) fail("Upload a PNG, JPG or WebP logo smaller than 200 KB");
    design.logo = validateProductImage(input.logo);
  } else design.logo = null;
  return design;
}

export const qrDesignService = {
  async get(businessId) {
    const [row, business] = await Promise.all([
      prisma.stateDocument.findUnique({ where: { key: key(businessId) } }),
      prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    ]);
    return { ...DEFAULT_DESIGN, ...(row?.data?.design || {}), saved: Boolean(row), updated_at: row?.updatedAt?.toISOString() || null, business_name: business?.name || "" };
  },
  async save(businessId, input, user) {
    const design = validateDesign(input);
    const data = { business_id: businessId, design, updated_by: user?.id || null };
    await prisma.stateDocument.upsert({ where: { key: key(businessId) }, create: { key: key(businessId), data }, update: { data } });
    return this.get(businessId);
  },
};
