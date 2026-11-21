import { readExportPage } from "../../shared/utils/export-cursor.js";
import prisma from "../../database/prisma/client.js";
import { attachProductImages, saveProductImage } from "./product-images.js";
import { normalizeChannelSettings } from "./qr-menu-details.js";
import {
  ensureBusiness,
  serializeProduct,
  syncProductAddons,
  syncProductVariations,
} from "../../database/prisma/helpers.js";
import {
  DEFAULT_PRODUCT_CATEGORY,
  DEFAULT_PRODUCT_DIETARY_TYPE,
} from "../../shared/constants/domain.constants.js";
import { getPagination } from "../../shared/utils/pagination.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { operationalWrite } from "../../shared/utils/operational-write.js";
import { availability, effectiveBase, loadActiveRules, MENU_CHANNELS } from "../menu/menu-pricing.js";
import { comboAvailableStock, saveMenuStructure } from "../menu/menu-structure.service.js";

// With an outlet, only that outlet's menu settings are loaded; without one, all of them (for the Products screen).
const getProductInclude = (outletId = null) => ({
  business: true,
  variations: true,
  addons: true,
  modifierGroups: { include: { options: { orderBy: { sortOrder: "asc" } } }, orderBy: { sortOrder: "asc" } },
  comboComponents: { include: { component: { select: { id: true, name: true, stock: true } } } },
  outletLinks: outletId ? { where: { outletId } } : true,
});

const validateProductNumbers = payload => {
  for (const [field, maximum] of [["price", 9999999999.99], ["cost_price", 999999999999.999999], ["stock", 2147483647]]) {
    if (payload[field] === undefined) continue;
    const value = Number(payload[field]);
    if (!Number.isFinite(value) || value < 0 || value > maximum || (field === "stock" && !Number.isInteger(value))) {
      throw createHttpError({ statusCode: 400, code: "INVALID_PRODUCT_NUMBER", message: `${field} must be a valid nonnegative ${field === "stock" ? "whole quantity" : "amount"}` });
    }
  }
};

class ProductsService {
  /**
   * The menu as it sells right now at this outlet on this channel, priced by the shared engine so the screen shows
   * exactly what billing will charge. `base_price` is always the product's own price (what the Products screen edits).
   */
  applyMenuContext(product, { outletId, channel, rules, at }) {
    const serialized = serializeProduct(product);
    const comboStock = comboAvailableStock(product);
    const stockFields = comboStock === null ? {} : { stock: comboStock };
    if (!outletId && !channel) {
      return { ...serialized, ...stockFields, base_price: serialized.price };
    }
    const outletLink = outletId ? product.outletLinks?.[0] || null : null;
    if (!availability(product, { outletLink, channel }).available && product.active !== false) {
      return null;
    }
    const priced = effectiveBase(product, { outletLink, channel, salesChannel: channel, outletId, at, rules });
    return {
      ...serialized,
      ...stockFields,
      base_price: serialized.price,
      list_price: priced.listPrice,
      price: priced.price,
      price_rule: priced.rule
        ? { id: priced.rule.id, name: priced.rule.name, discount_type: priced.rule.discountType, value: priced.rule.value }
        : null,
      outlet_product_enabled: outletLink?.enabled ?? true,
    };
  }

  async listProducts({ tenantId, query = {} }) {
    const business = await ensureBusiness({ tenantId });
    const outletId = query.outlet_id || query.outletId || null;
    const channel = MENU_CHANNELS.includes(query.channel) ? query.channel : null;
    const pagination = getPagination(query);
    const [products, rules] = await Promise.all([
      readExportPage(prisma.product, {
        where: { businessId: business.id },
        include: getProductInclude(outletId),
        orderBy: { createdAt: "asc" },
        take: pagination.take,
        skip: pagination.skip,
      }, query),
      loadActiveRules(prisma, business.id),
    ]);
    const at = new Date();

    return attachProductImages(products
      .map((product) => this.applyMenuContext(product, { outletId, channel, rules, at }))
      .filter(Boolean), business.id);
  }

  async getProductById({ tenantId, productId }) {
    const business = await ensureBusiness({ tenantId });
    const product = await prisma.product.findFirstOrThrow({
      where: {
        id: productId,
        businessId: business.id,
      },
      include: getProductInclude(),
    });

    return (await attachProductImages([serializeProduct(product)], business.id))[0];
  }

  async createProduct({ tenantId, payload, sourceProductId = null, commandId = null }) {
    validateProductNumbers(payload);
    const business = await ensureBusiness({ tenantId });
    const createdProduct = await operationalWrite({ businessId: business.id, kind: "product-create", payload: { ...payload, request_id: commandId } }, async (tx) => {
      if (sourceProductId) {
        const previous = await tx.product.findFirst({ where: { id: sourceProductId, businessId: business.id } });
        if (previous) return previous;
      }
      const created = await tx.product.create({
      data: {
        ...(sourceProductId ? { id: sourceProductId } : {}),
        businessId: business.id,
        name: payload.name || "New Product",
        price: Number(payload.price || 0),
        costPrice: Number(payload.cost_price || 0),
        stock: Number(payload.stock || 0),
        active: payload.active ?? true,
        category: payload.category || DEFAULT_PRODUCT_CATEGORY,
        dietaryType: payload.dietary_type || DEFAULT_PRODUCT_DIETARY_TYPE,
        recipeLines: payload.recipe_lines || [],
        channelSettings: normalizeChannelSettings(payload.channel_settings),
        outletOverrides: [],
        removalOptions: payload.removal_options || [],
      },
    });
      await saveMenuStructure({ tx, businessId: business.id, productId: created.id, payload });
      await saveProductImage(tx, business.id, created.id, payload);
      await syncProductVariations(created.id, payload.variation_options || [], tx);
      await syncProductAddons(created.id, payload.addon_options || [], tx);
      await admincoreChangeSyncService.notifyChange({ resource: "products", action: "created", recordId: created.id,
        tenantId, businessId: business.id, metadata: { name: created.name } }, { tx });
      return created;
    });

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: createdProduct.id },
      include: getProductInclude(),
    });

    const serializedProduct = (await attachProductImages([serializeProduct(product)], business.id))[0];
    return serializedProduct;
  }

  async updateProduct({ tenantId, productId, payload, commandId = null, expectedUpdatedAt = null }) {
    validateProductNumbers(payload);
    const business = await ensureBusiness({ tenantId });
    const currentProduct = await prisma.product.findFirstOrThrow({
      where: {
        id: productId,
        businessId: business.id,
      },
      include: getProductInclude(),
    });

    await operationalWrite({ businessId: business.id, kind: "product-update", payload: { ...payload, request_id: commandId } }, async (tx) => {
    const changed = await tx.product.updateMany({
      where: { id: productId, businessId: business.id, updatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : currentProduct.updatedAt },
      data: {
        name: payload.name ?? currentProduct.name,
        price: payload.price !== undefined ? Number(payload.price) : currentProduct.price,
        costPrice:
          payload.cost_price !== undefined ? Number(payload.cost_price) : currentProduct.costPrice,
        stock: payload.stock !== undefined ? Number(payload.stock) : currentProduct.stock,
        active: payload.active ?? currentProduct.active,
        category: payload.category ?? currentProduct.category,
        dietaryType: payload.dietary_type ?? currentProduct.dietaryType,
        recipeLines: payload.recipe_lines ?? currentProduct.recipeLines,
        channelSettings: normalizeChannelSettings(payload.channel_settings, currentProduct.channelSettings || {}),
        removalOptions: payload.removal_options ?? currentProduct.removalOptions,
      },
    });
    if (changed.count !== 1) throw createHttpError({ statusCode: 409, code: "PRODUCT_VERSION_CONFLICT", message: "The product changed while you were editing. Reload it before saving." });
    await saveMenuStructure({ tx, businessId: business.id, productId, payload });
    await saveProductImage(tx, business.id, productId, payload);
    if (payload.variation_options !== undefined) {
      await syncProductVariations(productId, payload.variation_options || [], tx);
    }

    if (payload.addon_options !== undefined) {
      await syncProductAddons(productId, payload.addon_options || [], tx);
    }
    await admincoreChangeSyncService.notifyChange({ resource: "products", action: "updated", recordId: productId,
      tenantId, businessId: business.id, metadata: { name: payload.name ?? currentProduct.name } }, { tx });
    return { id: productId };
    });

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: getProductInclude(),
    });

    const serializedProduct = (await attachProductImages([serializeProduct(product)], business.id))[0];
    return serializedProduct;
  }

  async deleteProduct({ tenantId, productId, expectedUpdatedAt = null }) {
    const business = await ensureBusiness({ tenantId });
    const product = await prisma.product.findFirstOrThrow({
      where: {
        id: productId,
        businessId: business.id,
      },
      include: getProductInclude(),
    });

    const combos = await prisma.comboComponent.findMany({
      where: { componentProductId: productId },
      include: { combo: { select: { name: true } } },
    });
    if (combos.length) {
      throw createHttpError({
        statusCode: 409,
        code: "PRODUCT_IN_COMBO",
        message: `Remove this item from ${combos.map((entry) => `"${entry.combo.name}"`).join(", ")} before deleting it`,
      });
    }

    await prisma.$transaction(async (tx) => {
      const changed = await tx.product.deleteMany({ where: { id: productId, businessId: business.id, updatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : product.updatedAt } });
      if (changed.count !== 1) throw createHttpError({ statusCode: 409, code: "PRODUCT_VERSION_CONFLICT", message: "The product changed before deletion. Reload it first." });
      await saveProductImage(tx, business.id, productId, { image_url: null });
      await admincoreChangeSyncService.notifyChange({ resource: "products", action: "deleted", recordId: productId,
        tenantId, businessId: business.id }, { tx });
    });

    return serializeProduct(product);
  }

  async adjustProductStock({ tenantId, productId, payload }) {
    const quantity = Number(payload.quantity ?? 0);
    const operation = payload.operation || "add";
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647 || !["add", "remove"].includes(operation)) {
      throw createHttpError({ statusCode: 400, code: "INVALID_STOCK_ADJUSTMENT", message: "Stock adjustments require a nonnegative whole quantity and an add/remove operation" });
    }
    const business = await ensureBusiness({ tenantId });
    await operationalWrite({ businessId: business.id, kind: `product-stock:${productId}`, payload }, async tx => {
      // Read and adjust while holding the same row lock as billing stock writes.
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} AND "businessId" = ${business.id} FOR UPDATE`;
      const current = await tx.product.findFirst({ where: { id: productId, businessId: business.id } });
      if (!current) throw createHttpError({ statusCode: 404, message: "Product not found" });
      const stock = operation === "remove" ? Math.max(0, current.stock - quantity) : current.stock + quantity;
      if (stock > 2147483647) throw createHttpError({ statusCode: 400, code: "INVALID_STOCK_ADJUSTMENT", message: "Resulting stock exceeds the supported quantity" });
      await tx.product.update({ where: { id: productId }, data: { stock } });
      await admincoreChangeSyncService.notifyChange({ resource: "products", action: "updated", recordId: productId, tenantId, businessId: business.id }, { tx });
      return { id: productId };
    });
    return this.getProductById({ tenantId, productId });
  }

  async listCatalog({ tenantId, query = {} }) {
    const products = await this.listProducts({ tenantId, query });

    return products.filter((product) => {
      const matchesChannel = !query.channel || product.channel_settings?.[query.channel]?.active !== false;
      return matchesChannel && (product.active ?? true);
    });
  }

  async updateVariations({ tenantId, productId, variations }) {
    return this.updateProduct({
      tenantId,
      productId,
      payload: { variation_options: variations || [] },
    });
  }

  async updateAddons({ tenantId, productId, addons }) {
    return this.updateProduct({
      tenantId,
      productId,
      payload: { addon_options: addons || [] },
    });
  }
}

export const productsService = new ProductsService();
