import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../../core/admincore/admincore-change-sync.service.js";
import { featureToggleService } from "../featureToggleService.js";
import { kotService } from "../../features/kitchen/kot/kot.service.js";
import { FEATURE_KEYS } from "../../shared/constants/module.constants.js";
import {
  appendKotAudit,
  buildKotItemState,
  createKotTicketNumber,
  getDefaultStations,
  KOT_STATUSES,
} from "../../features/kitchen/kot/kot.utils.js";

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const extractAddonNames = (addons) => {
  if (!Array.isArray(addons)) {
    return [];
  }

  return addons
    .map((item) => (typeof item === "string" ? item : item?.name))
    .filter(Boolean);
};

const extractRemovedIngredients = (item) => {
  const removals = item?.removed_ingredients || item?.removedIngredients || [];
  if (!Array.isArray(removals)) {
    return [];
  }

  return removals.map((entry) => normalizeText(entry)).filter(Boolean);
};

const shouldSkipRecipeLine = (line, removedIngredients) => {
  const ingredientName = normalizeText(line?.ingredient_name);
  if (!ingredientName || !removedIngredients.length) {
    return false;
  }

  return removedIngredients.some(
    (token) => ingredientName === token || ingredientName.includes(token),
  );
};

const addDemandLine = (demandMap, line, multiplier) => {
  const inventoryId = line?.inventory_id || line?.inventoryId;
  const quantity = Number(line?.quantity || 0) * Number(multiplier || 0);

  if (!inventoryId || !Number.isFinite(quantity) || quantity <= 0) {
    return;
  }

  const current = demandMap.get(inventoryId) || {
    inventoryItemId: inventoryId,
    ingredientName: line?.ingredient_name || line?.ingredientName || "Ingredient",
    unit: line?.unit || "",
    quantity: 0,
  };

  current.quantity += quantity;
  demandMap.set(inventoryId, current);
};

class OrderFulfillmentService {
  async ensureKotForOrder({ tenantId, businessId, orderId, status = "pending", tx = prisma }) {
    const kotEnabled = await featureToggleService.isFeatureEnabled(FEATURE_KEYS.KOT, businessId);
    if (!kotEnabled || !orderId) {
      return null;
    }

    return kotService.ensureTicketForOrder({ tx, businessId, orderId, status: "pending" });
  }

  async handleOrderCreated({ tenantId, businessId, orderId, tx = prisma }) {
    return this.ensureKotForOrder({
      tenantId,
      businessId,
      orderId,
      status: "pending",
      tx,
    });
  }

  async findProductForWorkflowItem({ businessId, item, tx = prisma }) {
    if (item?.productId || item?.product_id) {
      return tx.product.findFirst({
        where: {
          id: item.productId || item.product_id,
          businessId,
        },
        include: {
          variations: true,
          addons: true,
        },
      });
    }

    if (!item?.name) {
      return null;
    }

    return tx.product.findUnique({
      where: {
        businessId_name: {
          businessId,
          name: item.name,
        },
      },
      include: {
        variations: true,
        addons: true,
      },
    });
  }

  buildInventoryDemandForItem({ product, item }) {
    const quantity = Number(item?.quantity ?? 1);
    const variationName = item?.variation || "";
    const addonNames = extractAddonNames(item?.addons);
    const removedIngredients = extractRemovedIngredients(item);
    const selectedVariation = (product?.variations || []).find((entry) => entry.name === variationName);
    const selectedAddons = (product?.addons || []).filter((entry) => addonNames.includes(entry.name));

    const allLines = [
      ...(product?.recipeLines || []),
      ...(selectedVariation?.recipeLines || []),
      ...selectedAddons.flatMap((entry) => entry.recipeLines || []),
    ];

    const demandMap = new Map();
    for (const line of allLines) {
      if (shouldSkipRecipeLine(line, removedIngredients)) {
        continue;
      }

      addDemandLine(demandMap, line, quantity);
    }

    return [...demandMap.values()];
  }

  async handleBillIssued({
    tenantId,
    businessId,
    orderId,
    billId,
    outletId = null,
    items = [],
    tx = prisma,
  }) {
    const productAdjustments = new Map();
    const inventoryDemand = new Map();
    const recipeItems = [];
    const consumption = [];

    for (const item of items || []) {
      const product = await this.findProductForWorkflowItem({ businessId, item, tx });
      const quantity = Number(item?.quantity ?? 1);

      if (product) {
        const currentProductAdjustment = productAdjustments.get(product.id) || {
          nextStock: Number(product.stock || 0),
        };
        currentProductAdjustment.nextStock = Math.max(0, currentProductAdjustment.nextStock - quantity);
        productAdjustments.set(product.id, currentProductAdjustment);

        const recipeDemand = this.buildInventoryDemandForItem({ product, item });
        if (recipeDemand.length) recipeItems.push({ productId: product.id, quantity, demand: recipeDemand });
        for (const line of recipeDemand) {
          const currentDemand = inventoryDemand.get(line.inventoryItemId) || { ...line, quantity: 0 };
          currentDemand.quantity += Number(line.quantity || 0);
          inventoryDemand.set(line.inventoryItemId, currentDemand);
        }
      }
    }

    for (const [productId, adjustment] of productAdjustments.entries()) {
      await tx.product.update({
        where: { id: productId },
        data: { stock: adjustment.nextStock },
      });
    }

    for (const demand of inventoryDemand.values()) {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${demand.inventoryItemId} AND "businessId" = ${businessId} FOR UPDATE`;
      const inventoryItem = await tx.inventoryItem.findFirst({
        where: {
          id: demand.inventoryItemId,
          businessId,
        },
      });

      if (!inventoryItem) {
        throw createHttpError({ statusCode: 409, message: "Recipe ingredient does not belong to this business" });
      }

      const quantity = Number(demand.quantity);
      const changed = outletId
        ? await tx.outletInventory.updateMany({ where: { outletId, inventoryItemId: inventoryItem.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })
        : await tx.inventoryItem.updateMany({ where: { id: inventoryItem.id, businessId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
      if (!changed.count) throw createHttpError({ statusCode: 409, message: `Insufficient recipe stock for ${inventoryItem.name}${outletId ? " at this outlet" : ""}` });
      consumption.push({ inventory_id: inventoryItem.id, outlet_id: outletId, quantity, unit_cost: Number(inventoryItem.conversionCost || 0) });

      await tx.inventoryMovement.create({
        data: {
          businessId,
          inventoryItemId: inventoryItem.id,
          movementType: "bill_deduction",
          quantity: -Number(demand.quantity || 0),
          reason: `Inventory deducted for bill ${billId}${outletId ? ` at outlet ${outletId}` : " from central-store"}`,
        },
      });
    }

    const recipeCosts = new Map();
    for (const item of recipeItems) {
      const current = recipeCosts.get(item.productId) || { quantity: 0, cost: 0 };
      current.quantity += item.quantity;
      current.cost += item.demand.reduce((total, line) => total + line.quantity * consumption.find((entry) => entry.inventory_id === line.inventoryItemId).unit_cost, 0);
      recipeCosts.set(item.productId, current);
    }
    if (consumption.length) {
      await admincoreChangeSyncService.notifyChange({ resource: "inventory", action: "recipe_consumed", tenantId, businessId, outletId, recordId: billId }, { tx });
    }
    if (orderId) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: "billed" },
      });

      await this.ensureKotForOrder({
        tenantId,
        businessId,
        orderId,
        status: "completed",
        tx,
      });
    }
    return { consumption, recipeCosts };
  }
}

export const orderFulfillmentService = new OrderFulfillmentService();
