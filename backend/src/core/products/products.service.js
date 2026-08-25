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

const getProductInclude = (outletId = null) => ({
  business: true,
  variations: true,
  addons: true,
  ...(outletId
    ? {
        outletLinks: {
          where: { outletId },
        },
      }
    : {}),
});

class ProductsService {
  applyOutletContext(product, outletId) {
    const serialized = serializeProduct(product);
    if (!outletId) {
      return serialized;
    }

    const outletLink = product.outletLinks?.[0] || null;
    if (outletLink?.enabled === false) {
      return null;
    }

    return {
      ...serialized,
      price:
        outletLink?.priceOverride !== undefined && outletLink?.priceOverride !== null
          ? Number(outletLink.priceOverride)
          : serialized.price,
      outlet_product_enabled: outletLink?.enabled ?? true,
    };
  }

  async listProducts({ tenantId, query = {} }) {
    const business = await ensureBusiness({ tenantId });
    const outletId = query.outlet_id || query.outletId || null;
    const pagination = getPagination(query);
    const products = await prisma.product.findMany({
      where: { businessId: business.id },
      include: getProductInclude(outletId),
      orderBy: { createdAt: "asc" },
      take: pagination.take,
      skip: pagination.skip,
    });

    return products
      .map((product) => this.applyOutletContext(product, outletId))
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
    const createdProduct = await prisma.product.create({
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
        outletOverrides: payload.outlet_overrides || [],
        removalOptions: payload.removal_options || [],
      },
      include: getProductInclude(),
    });

    await syncProductVariations(createdProduct.id, payload.variation_options || []);
    await syncProductAddons(createdProduct.id, payload.addon_options || []);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: createdProduct.id },
      include: getProductInclude(),
    });

    return serializeProduct(product);
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
        outletOverrides: payload.outlet_overrides ?? currentProduct.outletOverrides,
        removalOptions: payload.removal_options ?? currentProduct.removalOptions,
      },
    });

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

    return serializeProduct(product);
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

    await prisma.product.delete({
      where: { id: productId },
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
