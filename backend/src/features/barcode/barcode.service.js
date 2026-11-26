import prisma from "../../database/prisma/client.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { nextInStoreBarcode } from "./barcode-rules.js";

// The products that carry a barcode (for labels and scanner checks), and generating in-store codes.
class BarcodeService {
  async listBarcodes({ tenantId }) {
    const business = await ensureBusiness({ tenantId });
    const products = await prisma.product.findMany({
      where: { businessId: business.id, barcode: { not: null } },
      select: { id: true, name: true, barcode: true, price: true, category: true, active: true },
      orderBy: { name: "asc" },
    });
    return {
      tenantId,
      items: products.map((product) => ({ product_id: product.id, name: product.name, barcode: product.barcode, price: Number(product.price), category: product.category, active: product.active })),
    };
  }

  /** Gives a product an in-store barcode. A product that already has one keeps it unless `replace` is true. */
  async generateBarcode({ tenantId, payload = {} }) {
    const business = await ensureBusiness({ tenantId });
    const productId = String(payload.product_id || payload.productId || "");
    if (!productId) throw createHttpError({ statusCode: 400, message: "Choose a product" });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`barcode:${business.id}`}))`;
      const product = await tx.product.findFirst({ where: { id: productId, businessId: business.id } });
      if (!product) throw createHttpError({ statusCode: 404, message: "Product not found" });
      if (product.barcode && payload.replace !== true) return { product_id: product.id, name: product.name, barcode: product.barcode, generated: false };
      const barcode = await nextInStoreBarcode(tx, business.id);
      await tx.product.update({ where: { id: product.id }, data: { barcode } });
      return { product_id: product.id, name: product.name, barcode, generated: true };
    });
  }
}

export const barcodeService = new BarcodeService();
