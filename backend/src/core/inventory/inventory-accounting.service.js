import { createHash, randomUUID } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { ensureBusiness } from "../../database/prisma/helpers.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";
import { moveStock } from "./stock-ledger.service.js";

const fail = (statusCode, message) => { throw createHttpError({ statusCode, message }); };
const notesOf = (receipt) => { try { return JSON.parse(receipt.notes || "{}"); } catch { return {}; } };

export async function listPurchaseReceipts({ tenantId }) {
  const business = await ensureBusiness({ tenantId });
  const receipts = await prisma.purchaseOrder.findMany({ where: { businessId: business.id, priority: "receiving", status: "received" },
    orderBy: { createdAt: "desc" }, take: 100 });
  return receipts.map((row) => ({ id: row.id, created_at: row.createdAt, items: row.items, ...notesOf(row) }));
}

export async function returnPurchase({ tenantId, receiptId, payload, user }) {
  if (!["Owner", "Manager"].includes(user?.role)) fail(403, "Manager approval is required for supplier returns");
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  const requestId = payload.request_id;
  if (!reason || reason.length > 500 || typeof requestId !== "string" || !/^[\w-]{8,100}$/.test(requestId)) fail(400, "Provide a reason and a valid return request ID");
  if (!Array.isArray(payload.items) || !payload.items.length) fail(400, "Select receipt lines to return");
  const seen = new Set();
  const lines = payload.items.map((line) => {
    if (typeof line.movement_id !== "string" || seen.has(line.movement_id) || typeof line.quantity !== "number" || !Number.isFinite(line.quantity) || line.quantity <= 0) fail(400, "Return lines require unique receipt movement IDs and positive quantities");
    seen.add(line.movement_id);
    return { movement_id: line.movement_id, quantity: line.quantity };
  }).sort((a, b) => a.movement_id.localeCompare(b.movement_id));
  const fingerprint = createHash("sha256").update(JSON.stringify({ reason, lines })).digest("hex");
  const business = await ensureBusiness({ tenantId });
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`purchase-return:${receiptId}`}))`;
    const receipt = await tx.purchaseOrder.findFirst({ where: { id: receiptId, businessId: business.id, priority: "receiving", status: "received" } });
    if (!receipt) fail(404, "Purchase receipt not found in this business");
    const notes = notesOf(receipt);
    const previous = notes.returns || [];
    const replay = previous.find((entry) => entry.request_id === requestId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) fail(409, "This request ID was already used for a different return");
      return replay;
    }
    const returnId = randomUUID();
    const returned = [];
    const ordered = lines.map((line) => {
      const original = receipt.items.find((entry) => entry.movement_id === line.movement_id);
      if (!original) fail(400, "Return line does not belong to this receipt");
      return { ...line, original };
    }).sort((a, b) => a.original.inventory_id.localeCompare(b.original.inventory_id));
    for (const line of ordered) {
      const original = line.original;
      const used = previous.flatMap((entry) => entry.items).filter((entry) => entry.receipt_movement_id === line.movement_id)
        .reduce((sum, entry) => sum + entry.quantity, 0);
      if (line.quantity > original.quantity - used + 1e-9) fail(409, "Return quantity exceeds the unreturned receipt quantity");
      if (!Number.isFinite(original.unit_cost) || original.unit_cost < 0) fail(409, "Receipt has no valid historical purchase cost");
      const moved = await moveStock({ tx, businessId: business.id, itemId: original.inventory_id,
        outletId: original.stock_outlet_id || null, quantity: -line.quantity, movementType: "supplier_return",
        referenceId: returnId, reason: `Supplier return against ${receiptId}: ${reason}` });
      returned.push({ receipt_movement_id: line.movement_id, movement_id: moved.movement.id,
        inventory_id: original.inventory_id, inventory_name: original.inventory_name, quantity: line.quantity,
        unit: original.unit, unit_cost: original.unit_cost, credit_amount: line.quantity * original.unit_cost,
        stock_value_removed: line.quantity * moved.unitCost });
    }
    const result = { id: returnId, request_id: requestId, fingerprint, reason, returned_at: new Date().toISOString(),
      returned_by: user.id, items: returned,
      credit_amount: returned.reduce((sum, line) => sum + line.credit_amount, 0),
      stock_value_removed: returned.reduce((sum, line) => sum + line.stock_value_removed, 0) };
    result.purchase_price_variance = result.credit_amount - result.stock_value_removed;
    await tx.purchaseOrder.update({ where: { id: receipt.id }, data: { notes: JSON.stringify({ ...notes, returns: [...previous, result] }) } });
    await admincoreChangeSyncService.notifyChange({ resource: "inventory", action: "supplier_returned", recordId: receipt.id,
      tenantId, businessId: business.id, metadata: { return_id: returnId } }, { tx });
    return result;
  });
}

export async function stockValuation({ tenantId }) {
  const business = await ensureBusiness({ tenantId });
  return prisma.$transaction(async (tx) => {
    const items = await tx.inventoryItem.findMany({ where: { businessId: business.id }, include: { outletLinks: { include: { outlet: true } } } });
    const locations = await tx.outlet.findMany({ where: { businessId: business.id }, select: { id: true, name: true } });
    const allocations = await tx.allocation.findMany({ where: { businessId: business.id, status: "approved" } });
    const movements = await tx.inventoryMovement.findMany({ where: { businessId: business.id }, orderBy: { sequence: "asc" } });
    const rows = [];
    for (const item of items) {
      const locations = [{ outletId: null, name: "Central store", stock: item.stock, cost: item.conversionCost },
        ...item.outletLinks.map((link) => ({ outletId: link.outletId, name: link.outlet.name, stock: link.stock,
          cost: link.unitCost ?? item.conversionCost, estimated: link.unitCost == null }))];
      for (const location of locations) {
        const ledger = movements.filter((row) => row.inventoryItemId === item.id && row.outletId === location.outletId && row.quantityAfter != null);
        const last = ledger.at(-1);
        const breaks = ledger.filter((entry, index) => index > 0 && (Math.abs(entry.quantityBefore - ledger[index - 1].quantityAfter) > 1e-7 || Math.abs(entry.valueBefore - ledger[index - 1].valueAfter) > 0.01)).length;
        const quantityDelta = last ? location.stock - last.quantityAfter : null;
        const valueDelta = last ? location.stock * location.cost - last.valueAfter : null;
        rows.push({ inventory_id: item.id, name: item.name, unit: item.unit, outlet_id: location.outletId,
          location: location.name, quantity: location.stock, unit_cost: location.cost, value: location.stock * location.cost,
          estimated_cost: Boolean(location.estimated), reconciliation: !last ? "opening_balance_unverified"
            : breaks || Math.abs(quantityDelta) > 1e-7 || Math.abs(valueDelta) > 0.01 ? "difference" : "matched",
          ledger_breaks: breaks, opening_quantity: ledger[0]?.quantityBefore ?? null, opening_value: ledger[0]?.valueBefore ?? null,
          movement_quantity: ledger.reduce((sum, entry) => sum + entry.quantity, 0),
          movement_value: ledger.reduce((sum, entry) => sum + entry.valueAfter - entry.valueBefore, 0),
          quantity_difference: quantityDelta, value_difference: valueDelta });
      }
    }
    const inTransit = allocations.flatMap((allocation) => (allocation.items || []).map((line) => ({
      transfer_id: allocation.id, inventory_id: line.inventory_id, name: line.inventory_name,
      quantity: Number(line.approved_quantity || 0), unit_cost: line.unit_cost ?? null,
      value: line.unit_cost == null ? null : Number(line.approved_quantity || 0) * line.unit_cost,
    })));
    return { generated_at: new Date().toISOString(), method: "moving_weighted_average", locations, rows, in_transit: inTransit,
      totals: { on_hand_value: rows.reduce((sum, row) => sum + row.value, 0),
        in_transit_value: inTransit.reduce((sum, row) => sum + (row.value || 0), 0),
        unvalued_transfers: inTransit.filter((row) => row.value == null).length,
        differences: rows.filter((row) => row.reconciliation === "difference").length,
        unverified_opening_balances: rows.filter((row) => row.reconciliation === "opening_balance_unverified").length } };
  }, { isolationLevel: "RepeatableRead" });
}
