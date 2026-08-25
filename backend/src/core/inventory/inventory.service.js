import prisma from "../../database/prisma/client.js";
import {
  ensureBusiness,
  serializeInventoryItem,
  toPrismaInventoryPayload,
} from "../../database/prisma/helpers.js";
import { getPagination } from "../../shared/utils/pagination.js";

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
    const item = await prisma.inventoryItem.create({
      data: {
        businessId: business.id,
        ...toPrismaInventoryPayload(payload),
      },
      include: getInventoryInclude(),
    });

    return serializeInventoryItem(item);
  }

  async updateItem({ tenantId, itemId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const currentItem = await prisma.inventoryItem.findFirstOrThrow({
      where: {
        id: itemId,
        businessId: business.id,
      },
      include: getInventoryInclude(),
    });

    const nextData = toPrismaInventoryPayload({
      name: payload.name ?? currentItem.name,
      stock: payload.stock ?? currentItem.stock,
      unit: payload.unit ?? currentItem.unit,
      reorderLevel: payload.reorderLevel ?? currentItem.reorderLevel,
      vendor: payload.vendor ?? currentItem.vendor,
      storage_location: payload.storage_location ?? currentItem.storageLocation,
      notes: payload.notes ?? currentItem.notes,
      expiry_date: payload.expiry_date ?? currentItem.expiryDate,
      conversion_cost: payload.conversion_cost ?? currentItem.conversionCost,
    });

    const item = await prisma.inventoryItem.update({
      where: { id: itemId },
      data: nextData,
      include: getInventoryInclude(),
    });

    return serializeInventoryItem(item);
  }

  async deleteItem({ tenantId, itemId }) {
    const business = await ensureBusiness({ tenantId });
    const item = await prisma.inventoryItem.findFirstOrThrow({
      where: {
        id: itemId,
        businessId: business.id,
      },
      include: getInventoryInclude(),
    });

    await prisma.inventoryItem.delete({
      where: { id: itemId },
    });

    return serializeInventoryItem(item);
  }
}

export const inventoryService = new InventoryService();
