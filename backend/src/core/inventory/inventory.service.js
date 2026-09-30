import prisma from "../../database/prisma/client.js";
import { moveStock } from "./stock-ledger.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import {
  ensureBusiness,
  serializeInventoryItem,
  toPrismaInventoryPayload,
} from "../../database/prisma/helpers.js";
import { getPagination } from "../../shared/utils/pagination.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

const getInventoryInclude = () => ({
  business: true,
});

class InventoryService {
  async listItems({ tenantId, query = {} }) {
    const business = await ensureBusiness({ tenantId });
    const pagination = getPagination(query);
    const items = await prisma.inventoryItem.findMany({
      where: { businessId: business.id },
      include: getInventoryInclude(),
      orderBy: { createdAt: "asc" },
      take: pagination.take,
      skip: pagination.skip,
    });

    return items.map(serializeInventoryItem);
  }

  async getItemById({ tenantId, itemId }) {
    const business = await ensureBusiness({ tenantId });
    const item = await prisma.inventoryItem.findFirstOrThrow({
      where: {
        id: itemId,
        businessId: business.id,
      },
      include: getInventoryInclude(),
    });

    return serializeInventoryItem(item);
  }

  async createItem({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const data = toPrismaInventoryPayload({ ...payload, stock: payload.current_stock ?? payload.stock, reorderLevel: payload.reorder_level ?? payload.reorderLevel });
    for (const value of [payload.current_stock ?? payload.stock ?? 0, payload.conversion_cost ?? payload.conversionCost ?? 0]) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) throw createHttpError({ statusCode: 400, message: "Stock and cost must be non-negative numbers" });
    }
    return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.create({
      data: {
        businessId: business.id,
        ...data, stock: 0,
      },
      include: getInventoryInclude(),
    });

    if (data.stock > 0) {
      await moveStock({ tx, businessId: business.id, itemId: item.id, quantity: data.stock, unitCost: data.conversionCost,
        movementType: "opening_stock", reason: "Opening inventory balance" });
      item.stock = data.stock;
    }
    const serializedItem = serializeInventoryItem(item);
    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "created",
      recordId: serializedItem.id,
      tenantId,
      businessId: business.id,
      metadata: {
        name: serializedItem.name,
        stock: serializedItem.stock,
        unit: serializedItem.unit,
      },
    }, { tx });

    return serializedItem;
    });
  }

  async updateItem({ tenantId, itemId, payload }) {
    const business = await ensureBusiness({ tenantId });
    return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} AND "businessId" = ${business.id} FOR UPDATE`;
    const currentItem = await tx.inventoryItem.findFirstOrThrow({
      where: {
        id: itemId,
        businessId: business.id,
      },
      include: getInventoryInclude(),
    });

    const nextData = toPrismaInventoryPayload({
      name: payload.name ?? currentItem.name,
      stock: payload.current_stock ?? payload.stock ?? currentItem.stock,
      unit: payload.unit ?? currentItem.unit,
      reorderLevel: payload.reorder_level ?? payload.reorderLevel ?? currentItem.reorderLevel,
      vendor: payload.vendor ?? currentItem.vendor,
      storage_location: payload.storage_location ?? currentItem.storageLocation,
      notes: payload.notes ?? currentItem.notes,
      expiry_date: payload.expiry_date ?? currentItem.expiryDate,
      conversion_cost: payload.conversion_cost ?? payload.conversionCost ?? currentItem.conversionCost,
    });
    for (const field of ["current_stock", "stock", "conversion_cost", "conversionCost"]) {
      if (payload[field] != null && (String(payload[field]).trim() === "" || !Number.isFinite(Number(payload[field])) || Number(payload[field]) < 0)) throw createHttpError({ statusCode: 400, message: "Stock and cost must be non-negative numbers" });
    }
    if (nextData.unit !== currentItem.unit && (currentItem.stock !== 0 || await tx.inventoryMovement.count({ where: { inventoryItemId: itemId } }) || await tx.outletInventory.count({ where: { inventoryItemId: itemId, stock: { not: 0 } } }))) throw createHttpError({ statusCode: 409, message: "Cannot change the unit of an ingredient with stock or movement history" });
    if (nextData.stock !== currentItem.stock) await moveStock({ tx, businessId: business.id, itemId,
      quantity: nextData.stock - currentItem.stock, movementType: "stock_edit_adjustment", reason: "Recorded stock count from inventory edit" });
    if (nextData.conversionCost !== currentItem.conversionCost) await moveStock({ tx, businessId: business.id, itemId,
      quantity: 0, unitCost: nextData.conversionCost, movementType: "cost_revaluation", reason: "Recorded inventory cost revaluation" });
    delete nextData.stock;
    delete nextData.conversionCost;
    const item = await tx.inventoryItem.update({
      where: { id: itemId },
      data: nextData,
      include: getInventoryInclude(),
    });

    await admincoreChangeSyncService.notifyChange({
      resource: "inventory", action: "updated", recordId: itemId,
      tenantId, businessId: business.id,
    }, { tx });

    return serializeInventoryItem(item);
    });
  }

  async deleteItem({ tenantId, itemId }) {
    const business = await ensureBusiness({ tenantId });
    return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} AND "businessId" = ${business.id} FOR UPDATE`;
    const item = await tx.inventoryItem.findFirstOrThrow({
      where: {
        id: itemId,
        businessId: business.id,
      },
      include: getInventoryInclude(),
    });

    if (item.stock !== 0 || await tx.inventoryMovement.count({ where: { inventoryItemId: itemId } }) || await tx.outletInventory.count({ where: { inventoryItemId: itemId, stock: { not: 0 } } })) throw createHttpError({ statusCode: 409, message: "Inventory with stock or accounting history cannot be deleted" });
    await tx.inventoryItem.delete({
      where: { id: itemId },
    });

    const serializedItem = serializeInventoryItem(item);
    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "deleted",
      recordId: serializedItem.id,
      tenantId,
      businessId: business.id,
      metadata: {
        name: serializedItem.name,
        stock: serializedItem.stock,
        unit: serializedItem.unit,
      },
    }, { tx });

    return serializedItem;
    });
  }
}

export const inventoryService = new InventoryService();
