import prisma from "../../database/prisma/client.js";
import { moveStock } from "../../core/inventory/stock-ledger.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../../core/admincore/admincore-change-sync.service.js";
import { convertRecipeQuantity } from "../../core/inventory/recipe-units.js";
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

  const key = `${inventoryId}:${normalizeText(line?.unit)}`;
  const current = demandMap.get(key) || {
    inventoryItemId: inventoryId,
    ingredientName: line?.ingredient_name || line?.ingredientName || "Ingredient",
    unit: line?.unit || "",
    quantity: 0,
  };

  current.quantity += quantity;
  demandMap.set(key, current);
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
      // Whole, positive units only: a negative quantity must never add stock back.
      const quantity = Math.max(0, Math.floor(Number(item?.quantity ?? 1)) || 0);

      if (product && quantity > 0) {
        const addStock = (productId, units) => {
          const current = productAdjustments.get(productId) || { quantity: 0 };
          current.quantity += units;
          productAdjustments.set(productId, current);
        };
        const loadProduct = async (productId, label) => {
          const found = await tx.product.findFirst({ where: { id: productId, businessId }, include: { variations: true, addons: true } });
          if (!found) throw createHttpError({ statusCode: 409, code: "MENU_ITEM_MISSING", message: `${label} is no longer on the menu` });
          return found;
        };
        // The sale-time snapshot (set by the price engine) says what was sold: combo components, chosen options.
        const detail = item?.modifiers && typeof item.modifiers === "object" ? item.modifiers : {};
        const comboComponents = Array.isArray(detail.combo_components) ? detail.combo_components : [];
        const chosenOptions = Array.isArray(detail.options) ? detail.options : [];
        const removals = item?.removed_ingredients || item?.removedIngredients || [];
        const recipeDemand = [];

        if (comboComponents.length) {
          // A combo sells its components: their stock and recipes are consumed, not the combo's own.
          for (const component of comboComponents) {
            const units = quantity * Math.max(1, Math.floor(Number(component.quantity) || 1));
            const componentProduct = await loadProduct(component.product_id, component.name || "A combo item");
            addStock(componentProduct.id, units);
            recipeDemand.push(...this.buildInventoryDemandForItem({ product: componentProduct, item: { quantity: units, removed_ingredients: removals } }));
          }
        } else {
          addStock(product.id, quantity);
          recipeDemand.push(...this.buildInventoryDemandForItem({ product, item }));
        }

        if (chosenOptions.length) {
          const optionRows = await tx.modifierOption.findMany({
            where: { id: { in: chosenOptions.map((option) => option.option_id).filter(Boolean) }, group: { product: { businessId } } },
          });
          for (const option of chosenOptions) {
            if (option.linked_product_id) {
              // e.g. the drink chosen in a meal deal is sold (and consumed) too.
              const linked = await loadProduct(option.linked_product_id, option.name || "A chosen item");
              addStock(linked.id, quantity);
              recipeDemand.push(...this.buildInventoryDemandForItem({ product: linked, item: { quantity, removed_ingredients: removals } }));
            }
            const row = optionRows.find((entry) => entry.id === option.option_id);
            if (Array.isArray(row?.recipeLines) && row.recipeLines.length) {
              recipeDemand.push(...this.buildInventoryDemandForItem({
                product: { recipeLines: row.recipeLines, variations: [], addons: [] },
                item: { quantity, removed_ingredients: removals },
              }));
            }
          }
        }

        for (const line of recipeDemand) {
          const ingredient = await tx.inventoryItem.findFirst({ where: { id: line.inventoryItemId, businessId }, select: { unit: true } });
          if (!ingredient) throw createHttpError({ statusCode: 409, message: "Recipe ingredient does not belong to this business" });
          line.quantity = convertRecipeQuantity(line.quantity, line.unit, ingredient.unit);
          line.unit = ingredient.unit;
        }
        if (recipeDemand.length) recipeItems.push({ productId: product.id, quantity, demand: recipeDemand });
        for (const line of recipeDemand) {
          const currentDemand = inventoryDemand.get(line.inventoryItemId) || { ...line, quantity: 0 };
          currentDemand.quantity += Number(line.quantity || 0);
          inventoryDemand.set(line.inventoryItemId, currentDemand);
        }
      }
    }

    // One atomic, conditional statement per product: a concurrent sale or stock edit can neither be overwritten by
    // a stale read nor push stock below zero. Selling more than is on hand is refused (the POS screen enforces the
    // same rule), instead of silently clamping stock to zero and losing the shortfall.
    for (const [productId, adjustment] of productAdjustments.entries()) {
      const updated = await tx.$executeRaw`UPDATE "Product" SET "stock" = "stock" - ${adjustment.quantity}::int WHERE "id" = ${productId} AND "businessId" = ${businessId} AND "stock" >= ${adjustment.quantity}::int`;
      if (!updated) {
        const product = await tx.product.findFirst({ where: { id: productId, businessId }, select: { name: true, stock: true } });
        throw createHttpError({
          statusCode: 409,
          code: "INSUFFICIENT_STOCK",
          message: `Only ${Math.max(0, Number(product?.stock || 0))} x ${product?.name || "item"} left in stock`,
          details: { product_id: productId, available: Number(product?.stock || 0), requested: adjustment.quantity },
        });
      }
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
      const moved = await moveStock({ tx, businessId, itemId: inventoryItem.id, outletId, quantity: -quantity,
        movementType: "bill_deduction", referenceId: billId, reason: `Inventory deducted for bill ${billId}` });
      consumption.push({ inventory_id: inventoryItem.id, outlet_id: outletId, quantity, unit_cost: moved.unitCost });
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
    const consumptionByProduct = recipeItems.map((item) => ({ product_id: item.productId, quantity: item.quantity,
      ingredients: item.demand.map((line) => ({ inventory_id: line.inventoryItemId, outlet_id: outletId,
        quantity: line.quantity, unit_cost: consumption.find((entry) => entry.inventory_id === line.inventoryItemId).unit_cost })) }));
    return { consumption, recipeCosts, consumptionByProduct };
  }
}

export const orderFulfillmentService = new OrderFulfillmentService();
