import prisma from "../../../database/prisma/client.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { validateProductImage } from "../../../core/products/product-images.js";
import { featureToggleService } from "../../../services/featureToggleService.js";
import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";

// How an outlet's guest menu looks: logo, cover photo, accent colour, welcome line, chef's picks and short videos.
// Videos are YouTube or Vimeo links (played from there): nothing is uploaded or stored here.

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_FEATURED = 6;
const MAX_VIDEOS = 3;
const outletKey = (outletId) => outletId || "business";
const key = (businessId, outletId) => `qr-brand:${businessId}:${outletKey(outletId)}`;
const fail = (message) => { throw createHttpError({ statusCode: 400, code: "QR_BRAND_INVALID", message }); };

/** The embeddable player address for a YouTube or Vimeo link, or null when the link is neither. */
export function videoEmbedUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let id = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else { const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/); id = match?.[1] || null; }
  }
  if (id) return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const match = url.pathname.match(/(?:^|\/)(\d{5,12})(?:\/|$)/);
    return match ? `https://player.vimeo.com/video/${match[1]}` : null;
  }
  return null;
}

const text = (value, limit, label) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.trim().length > limit) fail(`Keep the ${label} within ${limit} characters`);
  return value.trim();
};

async function assertOutlet(businessId, outletId) {
  if (!outletId) return;
  const outlet = await prisma.outlet.findFirst({ where: { id: outletId, businessId }, select: { id: true } });
  if (!outlet) throw createHttpError({ statusCode: 404, message: "Outlet not found" });
}

const imageUrl = (businessId, outletId, kind, version) => `/api/public/qr-studio/brand/${encodeURIComponent(businessId)}/${encodeURIComponent(outletKey(outletId))}/${kind}?v=${encodeURIComponent(version)}`;

export const qrBrandService = {
  async read(businessId, outletId) {
    return prisma.stateDocument.findUnique({ where: { key: key(businessId, outletId) } });
  },

  /** For staff: everything saved, images as data so they can be previewed and kept on re-save. */
  async get({ businessId, outletId }) {
    await assertOutlet(businessId, outletId);
    const row = await this.read(businessId, outletId);
    const brand = row?.data?.brand || {};
    return { outlet_id: outletId || null, saved: Boolean(row), accent: brand.accent || "#b45309", welcome: brand.welcome || "", logo: brand.logo || null, cover: brand.cover || null,
      featured: brand.featured || [], videos: (brand.videos || []).map((video) => ({ ...video, embed_url: videoEmbedUrl(video.url) })), updated_at: row?.updatedAt?.toISOString() || null };
  },

  async save({ businessId, outletId, payload = {}, user }) {
    await assertOutlet(businessId, outletId);
    if (payload.accent !== undefined && (typeof payload.accent !== "string" || !HEX.test(payload.accent))) fail("The accent colour must be written like #1a2b3c");
    const brand = {
      accent: (payload.accent || "#b45309").toLowerCase(),
      welcome: text(payload.welcome, 140, "welcome line"),
      logo: payload.logo ? validateProductImage(payload.logo) : null,
      cover: payload.cover ? validateProductImage(payload.cover) : null,
    };
    for (const field of ["logo", "cover"]) if (brand[field] && !brand[field].startsWith("data:")) fail("Upload the logo and cover photo as image files");
    const featured = payload.featured || [];
    if (!Array.isArray(featured) || featured.length > MAX_FEATURED || featured.some((id) => typeof id !== "string")) fail(`Choose up to ${MAX_FEATURED} chef's picks`);
    const unique = [...new Set(featured)];
    const found = await prisma.product.findMany({ where: { businessId, id: { in: unique }, active: true }, select: { id: true } });
    if (found.length !== unique.length) fail("A chef's pick is not an active menu item of this business");
    brand.featured = unique;
    const videos = payload.videos || [];
    if (!Array.isArray(videos) || videos.length > MAX_VIDEOS) fail(`Add up to ${MAX_VIDEOS} videos`);
    brand.videos = videos.map((video) => {
      const url = String(video?.url || "").trim();
      if (!videoEmbedUrl(url)) fail("Videos must be YouTube or Vimeo links (https)");
      return { title: text(video.title, 60, "video title"), url };
    });
    const data = { business_id: businessId, outlet_id: outletId || null, brand, updated_by: user?.id || null };
    await prisma.stateDocument.upsert({ where: { key: key(businessId, outletId) }, create: { key: key(businessId, outletId), data }, update: { data } });
    return this.get({ businessId, outletId });
  },

  /** What guests see; null when the plan has no QR Studio or nothing is saved for this outlet. */
  async publicBrand({ businessId, outletId }) {
    if (!await featureToggleService.isFeatureEnabled(FEATURE_KEYS.QR_STUDIO, businessId)) return null;
    const row = await this.read(businessId, outletId);
    if (!row?.data?.brand) return null;
    const brand = row.data.brand, version = row.updatedAt.getTime();
    return {
      accent: brand.accent, welcome: brand.welcome,
      logo_url: brand.logo ? imageUrl(businessId, outletId, "logo", version) : null,
      cover_url: brand.cover ? imageUrl(businessId, outletId, "cover", version) : null,
      featured_ids: brand.featured || [],
      videos: (brand.videos || []).map((video) => ({ title: video.title, embed_url: videoEmbedUrl(video.url) })).filter((video) => video.embed_url),
    };
  },

  async serveImage(req, res) {
    const { businessId, outletKey: outlet, kind } = req.params;
    if (!["logo", "cover"].includes(kind)) return res.sendStatus(404);
    const row = await prisma.stateDocument.findUnique({ where: { key: `qr-brand:${businessId}:${outlet}` } });
    const match = row?.data?.business_id === businessId && row.data.brand?.[kind]?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) return res.sendStatus(404);
    // The address carries the save time, so a new upload gets a new address and this one may be cached.
    res.set("Cache-Control", "public, max-age=86400");
    res.type(match[1]).send(Buffer.from(match[2], "base64"));
  },
};
