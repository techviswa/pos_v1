import { createHttpError } from "../../shared/utils/http-error.js";

const fail = (message) => { throw createHttpError({ statusCode: 409, message }); };

// All stock writers lock the ingredient first, including writers for outlet stock.
// A null outlet cost is legacy/unvalued stock: preserve that fact in reports.
export async function moveStock({ tx, businessId, itemId, outletId = null, quantity, unitCost,
  movementType, reason, referenceId = null, expiryDate = null }) {
  if (!Number.isFinite(quantity) || (quantity === 0 && movementType !== "cost_revaluation")) fail("Stock movement must have a finite non-zero quantity");
  if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) fail("Stock cost must be finite and non-negative");
  await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} AND "businessId" = ${businessId} FOR UPDATE`;
  const item = await tx.inventoryItem.findFirst({ where: { id: itemId, businessId } });
  if (!item) fail("Inventory item not found in this business");
  let balance = item;
  if (outletId) {
    if (!await tx.outlet.findFirst({ where: { id: outletId, businessId } })) fail("Outlet not found in this business");
    balance = await tx.outletInventory.findUnique({ where: { outletId_inventoryItemId: { outletId, inventoryItemId: itemId } } });
  }
  const before = balance?.stock || 0;
  const currentCost = outletId ? (balance?.unitCost ?? item.conversionCost) : item.conversionCost;
  const appliedCost = quantity > 0 ? (unitCost ?? currentCost) : currentCost;
  const after = before + quantity;
  if (after < -1e-9) fail(`Insufficient recipe stock or inventory stock for ${item.name}`);
  const nextQuantity = Math.max(0, after);
  const nextCost = quantity === 0 && movementType === "cost_revaluation" ? (unitCost ?? currentCost) : quantity > 0 && nextQuantity > 0
    ? (before * currentCost + quantity * appliedCost) / nextQuantity : currentCost;
  if (![nextQuantity, nextCost, nextQuantity * nextCost].every(Number.isFinite)) fail("Stock valuation exceeds supported numeric range");
  if (outletId) {
    await tx.outletInventory.upsert({ where: { outletId_inventoryItemId: { outletId, inventoryItemId: itemId } },
      update: { stock: nextQuantity, unitCost: nextCost },
      create: { outletId, inventoryItemId: itemId, stock: nextQuantity, unitCost: nextCost, reorderLevel: item.reorderLevel, enabled: true } });
  } else {
    await tx.inventoryItem.update({ where: { id: itemId }, data: { stock: nextQuantity, conversionCost: nextCost,
      ...(expiryDate ? { expiryDate: new Date(expiryDate) } : {}) } });
  }
  const movement = await tx.inventoryMovement.create({ data: { businessId, inventoryItemId: itemId, outletId,
    movementType, quantity, unitCost: appliedCost, quantityBefore: before, quantityAfter: nextQuantity,
    valueBefore: before * currentCost, valueAfter: nextQuantity * nextCost, reason, referenceId,
    ...(expiryDate ? { expiryDate: new Date(expiryDate) } : {}) } });
  return { movement, unitCost: appliedCost, item: { ...item, stock: nextQuantity, conversionCost: nextCost } };
}
