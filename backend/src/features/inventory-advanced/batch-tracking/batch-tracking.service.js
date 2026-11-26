import prisma from "../../../database/prisma/client.js";
import { ensureBusiness } from "../../../database/prisma/helpers.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { estimateRemaining, parseExpiry } from "./batch-rules.js";

const DAY = 86400000;
const status = (expiry, remaining, now) => {
  if (remaining <= 0) return "used_up";
  const days = Math.floor((expiry.getTime() - now.getTime()) / DAY);
  return days < 0 ? "expired" : days <= 14 ? "expiring" : "ok";
};

// Received lots per ingredient and location, with the estimated quantity still on hand and expiry alerts.
class BatchTrackingService {
  async listBatches({ tenantId, outletIds = null, now = new Date() }) {
    const business = await ensureBusiness({ tenantId });
    const batches = await prisma.batch.findMany({
      where: { businessId: business.id, inventoryItemId: { not: null }, ...(outletIds ? { outletId: { in: outletIds } } : {}) },
      orderBy: { expiryDate: "asc" },
    });
    const itemIds = [...new Set(batches.map((batch) => batch.inventoryItemId))];
    const [items, balances, outlets] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { businessId: business.id, id: { in: itemIds } }, select: { id: true, name: true, unit: true, stock: true } }),
      prisma.outletInventory.findMany({ where: { inventoryItemId: { in: itemIds }, outlet: { businessId: business.id } }, select: { outletId: true, inventoryItemId: true, stock: true } }),
      prisma.outlet.findMany({ where: { businessId: business.id }, select: { id: true, name: true } }),
    ]);
    const remaining = new Map();
    const groups = new Map();
    for (const batch of batches) {
      const key = `${batch.inventoryItemId}:${batch.outletId || "central"}`;
      groups.set(key, [...(groups.get(key) || []), batch]);
    }
    for (const [key, group] of groups) {
      const [itemId, location] = key.split(":");
      const stock = location === "central"
        ? items.find((item) => item.id === itemId)?.stock
        : balances.find((row) => row.outletId === location && row.inventoryItemId === itemId)?.stock;
      for (const [id, value] of estimateRemaining(group, stock)) remaining.set(id, value);
    }
    const rows = batches.map((batch) => {
      const item = items.find((row) => row.id === batch.inventoryItemId);
      const left = remaining.get(batch.id) ?? 0;
      return {
        id: batch.id, batch_no: batch.batchNo, inventory_id: batch.inventoryItemId, inventory_name: item?.name || "Ingredient", unit: item?.unit || "",
        location: batch.outletId ? outlets.find((outlet) => outlet.id === batch.outletId)?.name || "Outlet" : "Central kitchen", outlet_id: batch.outletId,
        received_quantity: Number(batch.quantity), estimated_remaining: left, unit_cost: batch.unitCost == null ? null : Number(batch.unitCost),
        expiry_date: batch.expiryDate.toISOString().slice(0, 10), days_to_expiry: Math.floor((batch.expiryDate.getTime() - now.getTime()) / DAY),
        status: status(batch.expiryDate, left, now), receipt_id: batch.receiptId, received_at: batch.createdAt.toISOString(),
      };
    });
    return {
      tenantId,
      estimate_note: "Remaining quantities are estimated: stock is assumed to be used earliest-expiry first.",
      items: rows,
      alerts: { expired: rows.filter((row) => row.status === "expired").length, expiring: rows.filter((row) => row.status === "expiring").length },
    };
  }

  /** Records a lot for stock already on hand (does not change stock; use receiving to add stock). */
  async createBatch({ tenantId, payload = {}, outletScope = null }) {
    const business = await ensureBusiness({ tenantId });
    const batchNo = String(payload.batch_no ?? payload.batchNo ?? "").trim();
    if (!batchNo || batchNo.length > 60) throw createHttpError({ statusCode: 400, message: "Enter a batch number (up to 60 characters)" });
    const item = await prisma.inventoryItem.findFirst({ where: { id: String(payload.inventory_id || ""), businessId: business.id } });
    if (!item) throw createHttpError({ statusCode: 404, message: "Ingredient not found" });
    const quantity = Number(payload.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw createHttpError({ statusCode: 400, message: "Enter the quantity in this batch" });
    const outletId = payload.outlet_id || null;
    if (outletId && !await prisma.outlet.findFirst({ where: { id: outletId, businessId: business.id }, select: { id: true } })) throw createHttpError({ statusCode: 404, message: "Outlet not found" });
    if (outletScope && (!outletId || !outletScope.includes(outletId))) throw createHttpError({ statusCode: 403, message: "You can record batches only at your outlets" });
    const batch = await prisma.batch.create({ data: { businessId: business.id, sku: item.id, batchNo, expiryDate: parseExpiry(payload.expiry_date), inventoryItemId: item.id, outletId, quantity } });
    return { id: batch.id, batch_no: batch.batchNo, inventory_id: item.id, expiry_date: batch.expiryDate.toISOString().slice(0, 10), quantity };
  }
}

export const batchTrackingService = new BatchTrackingService();
