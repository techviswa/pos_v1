import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

export async function reverseBillStock({ tenantId, invoiceId, user, payload }) {
  const fail = (statusCode, message) => { throw createHttpError({ statusCode, message }); };
  if (!["Owner", "Manager"].includes(user?.role)) fail(403, "Manager approval is required to restore stock");
  if (payload?.unprepared !== true || !String(payload?.reason || "").trim()) fail(400, "Confirm the ingredients are unused and provide a reason");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${invoiceId}`}))`;
    const bill = await tx.bill.findFirst({ where: { id: invoiceId, business: { tenantId } } });
    if (!bill) fail(404, "Invoice not found");
    const metadata = bill.metadata || {};
    if (metadata.stock_reversal) return metadata.stock_reversal;
    if (!["void", "refunded"].includes(bill.status)) fail(409, "Only voided or fully refunded invoices can restore unused ingredients");
    const consumption = metadata.inventory_consumption;
    if (!Array.isArray(consumption) || !consumption.length) fail(409, "This invoice has no recorded ingredient consumption to restore");
    const movementIds = [];
    for (const entry of consumption) {
      if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) fail(409, "Invalid recorded consumption; stock was not changed");
      const item = await tx.inventoryItem.findFirst({ where: { id: entry.inventory_id, businessId: bill.businessId } });
      if (!item) fail(409, "Recorded ingredient no longer belongs to this business");
      if (entry.outlet_id) {
        const outlet = await tx.outlet.findFirst({ where: { id: entry.outlet_id, businessId: bill.businessId } });
        if (!outlet) fail(409, "Recorded outlet no longer belongs to this business");
        await tx.outletInventory.upsert({ where: { outletId_inventoryItemId: { outletId: outlet.id, inventoryItemId: item.id } },
          update: { stock: { increment: entry.quantity } }, create: { outletId: outlet.id, inventoryItemId: item.id, stock: entry.quantity, reorderLevel: item.reorderLevel, enabled: true } });
      } else await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: { increment: entry.quantity } } });
      const movement = await tx.inventoryMovement.create({ data: { businessId: bill.businessId, inventoryItemId: item.id, movementType: "bill_reversal", quantity: entry.quantity, reason: `Unused ingredients restored for invoice ${invoiceId}: ${String(payload.reason).trim()}` } });
      movementIds.push(movement.id);
    }
    const reversal = { reversed_at: new Date().toISOString(), reversed_by: user.id, reason: String(payload.reason).trim(), movement_ids: movementIds };
    await tx.bill.update({ where: { id: bill.id }, data: { metadata: { ...metadata, stock_reversal: reversal } } });
    await admincoreChangeSyncService.notifyChange({ resource: "inventory", action: "bill_stock_reversed", tenantId, businessId: bill.businessId, recordId: bill.id }, { tx });
    return reversal;
  });
}
