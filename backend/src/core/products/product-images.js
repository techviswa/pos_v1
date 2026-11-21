import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";

const imageKey = (businessId, productId) => `product-image:${businessId}:${productId}`;
export const validateProductImage = (value) => {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 700000) throw createHttpError({ statusCode: 400, message: "Choose an image smaller than 500 KB." });
  if (/^https?:\/\//i.test(value)) {
    try { new URL(value); return value; } catch { /* handled below */ }
  }
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (match) {
    const bytes = Buffer.from(match[2], "base64");
    const valid = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (valid && bytes.length <= 500000) return value;
  }
  throw createHttpError({ statusCode: 400, message: "Use a JPG, PNG or WebP photo, or an http(s) image URL." });
};

export const saveProductImage = async (tx, businessId, productId, payload) => {
  if (!Object.prototype.hasOwnProperty.call(payload, "image_url")) return;
  if (payload.image_url === `/api/public/qr/product-images/${businessId}/${productId}`) return;
  const image = validateProductImage(payload.image_url);
  const key = imageKey(businessId, productId);
  if (!image) { await tx.stateDocument.deleteMany({ where: { key } }); return; }
  await tx.stateDocument.upsert({ where: { key }, create: { key, data: { image } }, update: { data: { image } } });
};

export const attachProductImages = async (products, businessId) => {
  const images = await prisma.stateDocument.findMany({ where: { key: { in: products.map((product) => imageKey(businessId, product.id)) } } });
  const indexed = new Map(images.map((row) => [row.key, row.data.image]));
  return products.map((product) => {
    const image = indexed.get(imageKey(businessId, product.id));
    return { ...product, image_url: image?.startsWith("data:") ? `/api/public/qr/product-images/${businessId}/${product.id}` : image || null };
  });
};

export const serveProductImage = async (req, res) => {
  const { businessId, productId } = req.params;
  const product = await prisma.product.findFirst({ where: { id: productId, businessId, active: true }, select: { id: true } });
  const row = product && await prisma.stateDocument.findUnique({ where: { key: imageKey(businessId, productId) } });
  const match = row?.data?.image?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) return res.sendStatus(404);
  res.set("Cache-Control", "no-store");
  res.type(match[1]).send(Buffer.from(match[2], "base64"));
};
