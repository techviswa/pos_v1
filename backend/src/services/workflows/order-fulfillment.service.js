import prisma from "../../database/prisma/client.js";
import { featureToggleService } from "../featureToggleService.js";
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

    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        businessId,
      },
      include: { items: true },
    });

    if (!order) {
      return null;
    }

    const existingTicket = await tx.kitchenTicket.findFirst({
      where: {
        businessId,
        orderId,
      },
    });

    const ticket = existingTicket
      ? existingTicket
      : await tx.kitchenTicket.create({
          data: {
            businessId,
            orderId,
            status,
          },
        });

    let resolvedTicket = ticket;
    if (existingTicket) {
      if (status && existingTicket.status !== status) {
        resolvedTicket = await tx.kitchenTicket.update({
          where: { id: existingTicket.id },
          data: { status },
        });
      }
    }

    const currentKot = order.metadata?.kot || {};
    const sequence = await tx.kitchenTicket.count({ where: { businessId } });
    const kot = appendKotAudit(
      {
        ticket_number:
          currentKot.ticket_number ||
          createKotTicketNumber({ createdAt: resolvedTicket.createdAt, sequence }),
        created_at: currentKot.created_at || resolvedTicket.createdAt.toISOString(),
        estimated_prep_minutes: currentKot.estimated_prep_minutes || order.metadata?.estimated_prep_minutes || 20,
        token_number: currentKot.token_number || order.metadata?.token_number || null,
        items: buildKotItemState({
          orderItems: order.items || [],
          stations: getDefaultStations(),
          existingItems: currentKot.items || [],
        }).map((item) => ({
          ...item,
          status:
            status === KOT_STATUSES.COMPLETED && item.status !== KOT_STATUSES.REJECTED
              ? KOT_STATUSES.SERVED
              : item.status,
        })),
        audit: currentKot.audit || [],
      },
      {
        action: "ticket_created_or_synced",
        status,
      },
    );

    await tx.order.update({
      where: { id: order.id },
      data: {
        metadata: {
          ...(order.metadata || {}),
          kot,
        },
      },
    });

    return resolvedTicket;
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
    const quantity = Math.max(1, Number(item?.quantity || 1));
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
    items = [],
    tx = prisma,
  }) {
    const productAdjustments = new Map();
    const inventoryDemand = new Map();

    for (const item of items || []) {
      const product = await this.findProductForWorkflowItem({ businessId, item, tx });
      const quantity = Math.max(1, Number(item?.quantity || 1));

      if (product) {
        const currentProductAdjustment = productAdjustments.get(product.id) || {
          nextStock: Number(product.stock || 0),
        };
        currentProductAdjustment.nextStock = Math.max(0, currentProductAdjustment.nextStock - quantity);
        productAdjustments.set(product.id, currentProductAdjustment);

        const recipeDemand = this.buildInventoryDemandForItem({ product, item });
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
      const inventoryItem = await tx.inventoryItem.findFirst({
        where: {
          id: demand.inventoryItemId,
          businessId,
        },
      });

      if (!inventoryItem) {
        continue;
      }

      const nextStock = Math.max(0, Number(inventoryItem.stock || 0) - Number(demand.quantity || 0));

      await tx.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: { stock: nextStock },
      });

      await tx.inventoryMovement.create({
        data: {
          businessId,
          inventoryItemId: inventoryItem.id,
          movementType: "bill_deduction",
          quantity: -Number(demand.quantity || 0),
          reason: `Inventory deducted for bill ${billId}`,
        },
      });
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
  }
}

export const orderFulfillmentService = new OrderFulfillmentService();
