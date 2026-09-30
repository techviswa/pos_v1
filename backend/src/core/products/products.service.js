import prisma from "../../database/prisma/client.js";
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
      prisma.product.findMany({
        where: { businessId: business.id },
        include: getProductInclude(outletId),
        orderBy: { createdAt: "asc" },
        take: pagination.take,
        skip: pagination.skip,
      }),
      loadActiveRules(prisma, business.id),
    ]);
    const at = new Date();

    return products
      .map((product) => this.applyMenuContext(product, { outletId, channel, rules, at }))
      .filter(Boolean);
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

    return serializeProduct(product);
  }

  async createProduct({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const createdProduct = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
      data: {
        businessId: business.id,
        name: payload.name || "New Product",
        price: Number(payload.price || 0),
        costPrice: Number(payload.cost_price || 0),
        stock: Number(payload.stock || 0),
        active: payload.active ?? true,
        category: payload.category || DEFAULT_PRODUCT_CATEGORY,
        dietaryType: payload.dietary_type || DEFAULT_PRODUCT_DIETARY_TYPE,
        recipeLines: payload.recipe_lines || [],
        channelSettings: payload.channel_settings || {},
        outletOverrides: [],
        removalOptions: payload.removal_options || [],
      },
    });
      await saveMenuStructure({ tx, businessId: business.id, productId: created.id, payload });
      return created;
    });

    await syncProductVariations(createdProduct.id, payload.variation_options || []);
    await syncProductAddons(createdProduct.id, payload.addon_options || []);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: createdProduct.id },
      include: getProductInclude(),
    });

    const serializedProduct = serializeProduct(product);
    await admincoreChangeSyncService.notifyChange({
      resource: "products",
      action: "created",
      recordId: serializedProduct.id,
      tenantId,
      businessId: business.id,
      metadata: {
        name: serializedProduct.name,
        price: serializedProduct.price,
        active: serializedProduct.active,
      },
    });

    return serializedProduct;
  }

  async updateProduct({ tenantId, productId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const currentProduct = await prisma.product.findFirstOrThrow({
      where: {
        id: productId,
        businessId: business.id,
      },
      include: getProductInclude(),
    });

    await prisma.product.update({
      where: { id: productId },
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
        channelSettings: payload.channel_settings ?? currentProduct.channelSettings,
        removalOptions: payload.removal_options ?? currentProduct.removalOptions,
      },
    });
    await prisma.$transaction((tx) => saveMenuStructure({ tx, businessId: business.id, productId, payload }));

    if (payload.variation_options !== undefined) {
      await syncProductVariations(productId, payload.variation_options || []);
    }

    if (payload.addon_options !== undefined) {
      await syncProductAddons(productId, payload.addon_options || []);
    }

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: getProductInclude(),
    });

    const serializedProduct = serializeProduct(product);
    await admincoreChangeSyncService.notifyChange({
      resource: "products",
      action: "updated",
      recordId: serializedProduct.id,
      tenantId,
      businessId: business.id,
      metadata: {
        name: serializedProduct.name,
        price: serializedProduct.price,
        active: serializedProduct.active,
      },
    });

    return serializedProduct;
  }

  async deleteProduct({ tenantId, productId }) {
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

    await prisma.product.delete({
      where: { id: productId },
    });

    await admincoreChangeSyncService.notifyChange({
      resource: "products", action: "deleted", recordId: productId,
      tenantId, businessId: business.id,
    });

    return serializeProduct(product);
  }

  async adjustProductStock({ tenantId, productId, payload }) {
    const quantity = Number(payload.quantity || 0);
    const operation = payload.operation || "add";
    const currentProduct = await this.getProductById({ tenantId, productId });

    const nextStock =
      operation === "remove"
        ? Math.max(0, Number(currentProduct.stock || 0) - quantity)
        : Number(currentProduct.stock || 0) + quantity;

    return this.updateProduct({
      tenantId,
      productId,
      payload: { stock: nextStock },
    });
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
