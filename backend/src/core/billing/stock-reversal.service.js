import prisma from "../../database/prisma/client.js";
import { createHash } from "node:crypto";
import { moveStock } from "../inventory/stock-ledger.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

export async function reverseBillStock({ tenantId, invoiceId, user, payload }) {
  const fail = (statusCode, message) => { throw createHttpError({ statusCode, message }); };
  if (!["Owner", "Manager"].includes(user?.role)) fail(403, "Manager approval is required to restore stock");
  if (payload?.unprepared !== true || typeof payload.reason !== "string" || !payload.reason.trim() || payload.reason.length > 500) fail(400, "Confirm the ingredients are unused and provide a reason (up to 500 characters)");
  if (payload.products !== undefined && !Array.isArray(payload.products)) fail(400, "Products must be a list of return quantities");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bill:${invoiceId}`}))`;
    const bill = await tx.bill.findFirst({ where: { id: invoiceId, business: { tenantId } } });
    if (!bill) fail(404, "Invoice not found");
    const metadata = bill.metadata || {};
    if (Array.isArray(payload.products)) return returnSelectedProducts({ tx, bill, metadata, payload, user, tenantId, fail });
    if (metadata.stock_reversal) return metadata.stock_reversal;
    if (!["void", "refunded"].includes(bill.status)) fail(409, "Only voided or fully refunded invoices can restore unused ingredients");
    const consumption = metadata.inventory_consumption;
    if (!Array.isArray(consumption) || !consumption.length) fail(409, "This invoice has no recorded ingredient consumption to restore");
    const movementIds = [];
    for (const entry of consumption) {
      if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) fail(409, "Invalid recorded consumption; stock was not changed");
      const item = await tx.inventoryItem.findFirst({ where: { id: entry.inventory_id, businessId: bill.businessId } });
      if (!item) fail(409, "Recorded ingredient no longer belongs to this business");
      const alreadyRestored = (metadata.stock_returns || []).flatMap((returned) => returned.items || [])
        .filter((line) => line.inventory_id === entry.inventory_id && line.outlet_id === entry.outlet_id).reduce((sum, line) => sum + line.quantity, 0);
      const remaining = entry.quantity - alreadyRestored;
      if (remaining <= 1e-9) continue;
      const { movement } = await moveStock({ tx, businessId: bill.businessId, itemId: item.id, outletId: entry.outlet_id || null,
        quantity: remaining, unitCost: entry.unit_cost, movementType: "bill_reversal", referenceId: invoiceId,
        reason: `Unused ingredients restored for invoice ${invoiceId}: ${String(payload.reason).trim()}` });
      movementIds.push(movement.id);
    }
    const reversal = { reversed_at: new Date().toISOString(), reversed_by: user.id, reason: String(payload.reason).trim(), movement_ids: movementIds };
    await tx.bill.update({ where: { id: bill.id }, data: { metadata: { ...metadata, stock_reversal: reversal } } });
    await admincoreChangeSyncService.notifyChange({ resource: "inventory", action: "bill_stock_reversed", tenantId, businessId: bill.businessId, recordId: bill.id }, { tx });
    return reversal;
  });
}

async function returnSelectedProducts({ tx, bill, metadata, payload, user, tenantId, fail }) {
  if (!["void", "refunded"].includes(bill.status) && !(metadata.refunded_amount > 0)) fail(409, "Record a refund or void approval before restoring unused items");
  if (typeof payload.request_id !== "string" || !/^[\w-]{8,100}$/.test(payload.request_id)) fail(400, "A valid return request ID is required");
  if (!payload.products.length) fail(400, "Select products and quantities to restore");
  const seen = new Set();
  const products = payload.products.map((entry) => {
    if (typeof entry.product_id !== "string" || seen.has(entry.product_id) || typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity) || entry.quantity <= 0) fail(400, "Select unique products with positive quantities");
    seen.add(entry.product_id);
    return { product_id: entry.product_id, quantity: entry.quantity };
  }).sort((a, b) => a.product_id.localeCompare(b.product_id));
  const fingerprint = createHash("sha256").update(JSON.stringify({ products, reason: payload.reason.trim() })).digest("hex");
  const returns = metadata.stock_returns || [];
  const replay = returns.find((entry) => entry.request_id === payload.request_id);
  if (replay) {
    if (replay.fingerprint !== fingerprint) fail(409, "Return request ID was used with different quantities or reason");
    return replay;
  }
  if (metadata.stock_reversal) fail(409, "All recorded ingredients have already been restored");
  const snapshots = metadata.inventory_consumption_by_product || [];
  const ingredients = new Map();
  for (const product of products) {
    const matches = snapshots.filter((entry) => entry.product_id === product.product_id);
    const sold = matches.reduce((sum, entry) => sum + entry.quantity, 0);
    const returned = returns.flatMap((entry) => entry.products).filter((entry) => entry.product_id === product.product_id).reduce((sum, entry) => sum + entry.quantity, 0);
    if (!sold || product.quantity > sold - returned + 1e-9) fail(409, "Quantity exceeds the remaining recorded recipe quantity; older invoices may not support partial restoration");
    for (const entry of matches.flatMap((match) => match.ingredients)) {
      const key = `${entry.inventory_id}:${entry.outlet_id || "central"}`;
      const previous = ingredients.get(key) || { ...entry, quantity: 0 };
      previous.quantity += entry.quantity * product.quantity / sold;
      ingredients.set(key, previous);
    }
  }
  const items = [...ingredients.values()].sort((a, b) => a.inventory_id.localeCompare(b.inventory_id));
  const movementIds = [];
  for (const entry of items) {
    const moved = await moveStock({ tx, businessId: bill.businessId, itemId: entry.inventory_id, outletId: entry.outlet_id || null,
      quantity: entry.quantity, unitCost: entry.unit_cost, movementType: "bill_partial_reversal", referenceId: bill.id,
      reason: `Unused portions returned: ${payload.reason.trim()}` });
    movementIds.push(moved.movement.id);
  }
  const result = { request_id: payload.request_id, fingerprint, products, items, movement_ids: movementIds,
    reason: payload.reason.trim(), returned_at: new Date().toISOString(), returned_by: user.id };
  await tx.bill.update({ where: { id: bill.id }, data: { metadata: { ...metadata, stock_returns: [...returns, result] } } });
  await admincoreChangeSyncService.notifyChange({ resource: "inventory", action: "bill_stock_partially_restored", tenantId,
    businessId: bill.businessId, recordId: bill.id }, { tx });
  return result;
}
