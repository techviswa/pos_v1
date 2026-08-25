import prisma from "../../database/prisma/client.js";
import {
  ensureBusiness,
  serializeAllocation,
  serializeInventoryItem,
  serializePurchaseOrder,
} from "../../database/prisma/helpers.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nowIso = () => new Date().toISOString();

const cloneJson = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
};

class InventoryOperationsService {
  async resolveOutletId({ tx = prisma, businessId, outletId }) {
    if (outletId) {
      const outlet = await tx.outlet.findFirst({ where: { id: outletId, businessId } });
      if (outlet) return outlet.id;
    }

    const outlet = await tx.outlet.findFirst({
      where: { businessId },
      orderBy: { createdAt: "asc" },
    });

    if (!outlet) {
      throw createHttpError({
        statusCode: 400,
        message: "Create an outlet before using inventory receiving or transfers",
      });
    }

    return outlet.id;
  }

  async findOrCreateInventoryItem({ tx = prisma, businessId, line }) {
    if (line.inventory_id || line.inventoryItemId) {
      const item = await tx.inventoryItem.findFirst({
        where: {
          id: line.inventory_id || line.inventoryItemId,
          businessId,
        },
      });
      if (item) return item;
    }

    const name = line.inventory_name || line.name || line.ingredient_name || "Inventory Item";
    return tx.inventoryItem.upsert({
      where: {
        businessId_name: {
          businessId,
          name,
        },
      },
      update: {},
      create: {
        businessId,
        name,
        stock: 0,
        unit: line.unit || "unit",
        reorderLevel: toNumber(line.reorder_level ?? line.reorderLevel, 0),
        vendor: line.vendor || null,
        conversionCost: toNumber(line.unit_cost ?? line.conversion_cost, 0),
      },
    });
  }

  async recordMovement({ tx = prisma, businessId, item, movementType, quantity, reason, expiryDate = null }) {
    const signedQuantity = toNumber(quantity, 0);
    const nextStock = Math.max(0, toNumber(item.stock, 0) + signedQuantity);
    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        stock: nextStock,
        ...(expiryDate ? { expiryDate: new Date(expiryDate) } : {}),
      },
    });

    const movement = await tx.inventoryMovement.create({
      data: {
        businessId,
        inventoryItemId: item.id,
        movementType,
        quantity: signedQuantity,
        reason: reason || "",
        expiryDate: expiryDate ? new Date(expiryDate) : null,
      },
    });

    return { item: updated, movement };
  }

  async receivePurchase({ tenantId, payload, user }) {
    const business = await ensureBusiness({ tenantId });
    const lines = Array.isArray(payload.items) ? payload.items : [];
    if (!lines.length) {
      throw createHttpError({ statusCode: 400, message: "Purchase receiving requires at least one item" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const outletId = await this.resolveOutletId({
        tx,
        businessId: business.id,
        outletId: payload.outlet_id || payload.outletId || null,
      });
      const receivedItems = [];
      for (const line of lines) {
        const item = await this.findOrCreateInventoryItem({ tx, businessId: business.id, line });
        const quantity = Math.max(0, toNumber(line.quantity ?? line.received_quantity, 0));
        const unitCost = toNumber(line.unit_cost ?? line.conversion_cost, item.conversionCost);

        const weightedCost =
          quantity > 0
            ? (toNumber(item.stock, 0) * toNumber(item.conversionCost, 0) + quantity * unitCost) /
              Math.max(1, toNumber(item.stock, 0) + quantity)
            : item.conversionCost;

        await tx.inventoryItem.update({
          where: { id: item.id },
          data: {
            conversionCost: weightedCost,
            vendor: payload.vendor_name || line.vendor || item.vendor,
          },
        });

        const movement = await this.recordMovement({
          tx,
          businessId: business.id,
          item,
          movementType: "purchase_receiving",
          quantity,
          reason: `Purchase received${payload.vendor_bill_number ? ` against bill ${payload.vendor_bill_number}` : ""}`,
          expiryDate: line.expiry_date || null,
        });
        receivedItems.push({
          inventory_id: item.id,
          inventory_name: item.name,
          quantity,
          unit: item.unit,
          unit_cost: unitCost,
          movement_id: movement.movement.id,
        });
      }

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          businessId: business.id,
          outletId,
          requestedById: user?.id || null,
          priority: "receiving",
          requiredBy: null,
          notes: JSON.stringify({
            type: "purchase_receiving",
            vendor_name: payload.vendor_name || null,
            vendor_bill_number: payload.vendor_bill_number || null,
            received_by: user?.name || null,
            received_at: nowIso(),
            total_amount: receivedItems.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0),
          }),
          status: "received",
          items: receivedItems,
        },
      });

      return { purchaseOrder, receivedItems };
    });

    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "purchase_received",
      recordId: result.purchaseOrder.id,
      tenantId,
      businessId: business.id,
      outletId: result.purchaseOrder.outletId,
      metadata: {
        received_item_count: result.receivedItems.length,
      },
    });

    return {
      record: serializePurchaseOrder(result.purchaseOrder, tenantId),
      received_items: result.receivedItems,
    };
  }

  async createVendorBill({ tenantId, payload, user }) {
    const business = await ensureBusiness({ tenantId });
    const outletId = await this.resolveOutletId({
      businessId: business.id,
      outletId: payload.outlet_id || payload.outletId || null,
    });
    const items = Array.isArray(payload.items) ? payload.items : [];
    const totalAmount =
      payload.total_amount !== undefined
        ? toNumber(payload.total_amount, 0)
        : items.reduce((sum, item) => sum + toNumber(item.quantity, 0) * toNumber(item.unit_cost, 0), 0);

    const vendorBill = await prisma.purchaseOrder.create({
      data: {
        businessId: business.id,
        outletId,
        requestedById: user?.id || null,
        priority: "vendor_bill",
        requiredBy: payload.due_date ? new Date(payload.due_date) : null,
        notes: JSON.stringify({
          type: "vendor_bill",
          vendor_name: payload.vendor_name || null,
          vendor_bill_number: payload.vendor_bill_number || null,
          bill_date: payload.bill_date || nowIso(),
          due_date: payload.due_date || null,
          total_amount: totalAmount,
          payment_status: payload.payment_status || "unpaid",
          created_by: user?.name || null,
        }),
        status: payload.status || "vendor_bill",
        items,
      },
    });

    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "vendor_bill_created",
      recordId: vendorBill.id,
      tenantId,
      businessId: business.id,
      outletId,
      metadata: {
        total_amount: totalAmount,
        vendor_name: payload.vendor_name || null,
      },
    });

    return {
      ...serializePurchaseOrder(vendorBill, tenantId),
      vendor_name: payload.vendor_name || null,
      vendor_bill_number: payload.vendor_bill_number || null,
      total_amount: totalAmount,
      payment_status: payload.payment_status || "unpaid",
    };
  }

  async recordWastage({ tenantId, itemId, payload, user }) {
    const business = await ensureBusiness({ tenantId });
    const item = await prisma.inventoryItem.findFirstOrThrow({
      where: { id: itemId, businessId: business.id },
    });
    const quantity = Math.max(0, toNumber(payload.quantity, 0));
    const type = payload.type || payload.movement_type || "wastage";
    const result = await this.recordMovement({
      businessId: business.id,
      item,
      movementType: ["spoilage", "pilferage"].includes(type) ? type : "wastage",
      quantity: -quantity,
      reason: payload.reason || `Recorded by ${user?.name || "system"}`,
      expiryDate: payload.expiry_date || null,
    });

    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "wastage_recorded",
      recordId: item.id,
      tenantId,
      businessId: business.id,
      metadata: {
        movement_id: result.movement.id,
        quantity,
        type,
      },
    });

    return {
      item: serializeInventoryItem({ ...result.item, business: { tenantId } }),
      movement: {
        id: result.movement.id,
        movement_type: result.movement.movementType,
        quantity: Math.abs(result.movement.quantity),
        reason: result.movement.reason,
        created_at: result.movement.createdAt.toISOString(),
      },
    };
  }

  async createTransferRequest({ tenantId, payload, user }) {
    const business = await ensureBusiness({ tenantId });
    const destinationOutletId = await this.resolveOutletId({
      businessId: business.id,
      outletId: payload.destination_outlet_id || payload.outlet_id || payload.outletId,
    });
    const allocation = await prisma.allocation.create({
      data: {
        businessId: business.id,
        outletId: destinationOutletId,
        purchaseOrderId: null,
        routePlanId: null,
        sourceLocation: payload.source_outlet_id || payload.source_location || "central-store",
        status: "pending_approval",
        items: (payload.items || []).map((item) => ({
          ...item,
          requested_quantity: toNumber(item.requested_quantity ?? item.quantity, 0),
        })),
      },
    });

    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "transfer_requested",
      recordId: allocation.id,
      tenantId,
      businessId: business.id,
      outletId: destinationOutletId,
      metadata: {
        status: allocation.status,
      },
    });

    return {
      ...serializeAllocation(allocation, tenantId),
      requested_by: user?.name || null,
      approval_required: true,
    };
  }

  async approveTransfer({ tenantId, allocationId, user }) {
    const business = await ensureBusiness({ tenantId });
    const allocation = await prisma.allocation.findFirstOrThrow({
      where: { id: allocationId, businessId: business.id },
    });

    const approved = await prisma.$transaction(async (tx) => {
      const items = cloneJson(allocation.items, []);
      for (const line of items) {
        const item = await this.findOrCreateInventoryItem({ tx, businessId: business.id, line });
        await this.recordMovement({
          tx,
          businessId: business.id,
          item,
          movementType: "stock_transfer_out",
          quantity: -Math.max(0, toNumber(line.approved_quantity ?? line.requested_quantity ?? line.quantity, 0)),
          reason: `Transfer approved to outlet ${allocation.outletId} by ${user?.name || "system"}`,
        });
      }

      return tx.allocation.update({
        where: { id: allocationId },
        data: {
          status: "approved",
          items: items.map((item) => ({
            ...item,
            approved_quantity: toNumber(item.approved_quantity ?? item.requested_quantity ?? item.quantity, 0),
            approved_by: user?.name || null,
            approved_at: nowIso(),
          })),
        },
      });
    });

    const serializedAllocation = serializeAllocation(approved, tenantId);
    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "transfer_approved",
      recordId: serializedAllocation.id,
      tenantId,
      businessId: business.id,
      outletId: serializedAllocation.outlet_id,
      metadata: {
        status: serializedAllocation.status,
      },
    });

    return serializedAllocation;
  }

  async receiveTransfer({ tenantId, allocationId, user }) {
    const business = await ensureBusiness({ tenantId });
    const allocation = await prisma.allocation.findFirstOrThrow({
      where: { id: allocationId, businessId: business.id },
    });

    const received = await prisma.$transaction(async (tx) => {
      const items = cloneJson(allocation.items, []);
      for (const line of items) {
        const item = await this.findOrCreateInventoryItem({ tx, businessId: business.id, line });
        const quantity = Math.max(0, toNumber(line.received_quantity ?? line.approved_quantity ?? line.quantity, 0));

        await tx.outletInventory.upsert({
          where: {
            outletId_inventoryItemId: {
              outletId: allocation.outletId,
              inventoryItemId: item.id,
            },
          },
          update: {
            stock: { increment: quantity },
            enabled: true,
          },
          create: {
            outletId: allocation.outletId,
            inventoryItemId: item.id,
            stock: quantity,
            reorderLevel: item.reorderLevel,
            enabled: true,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            businessId: business.id,
            inventoryItemId: item.id,
            movementType: "stock_transfer_received",
            quantity,
            reason: `Transfer received at outlet ${allocation.outletId} by ${user?.name || "system"}`,
          },
        });
      }

      return tx.allocation.update({
        where: { id: allocationId },
        data: {
          status: "received",
          items: items.map((item) => ({
            ...item,
            received_quantity: toNumber(item.received_quantity ?? item.approved_quantity ?? item.quantity, 0),
            received_by: user?.name || null,
            received_at: nowIso(),
          })),
        },
      });
    });

    const serializedAllocation = serializeAllocation(received, tenantId);
    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "transfer_received",
      recordId: serializedAllocation.id,
      tenantId,
      businessId: business.id,
      outletId: serializedAllocation.outlet_id,
      metadata: {
        status: serializedAllocation.status,
      },
    });

    return serializedAllocation;
  }

  async createStockAudit({ tenantId, payload, user }) {
    const business = await ensureBusiness({ tenantId });
    const counts = Array.isArray(payload.counts) ? payload.counts : [];
    if (!counts.length) {
      throw createHttpError({ statusCode: 400, message: "Stock audit requires at least one counted item" });
    }

    const audit = await prisma.$transaction(async (tx) => {
      const outletId = await this.resolveOutletId({
        tx,
        businessId: business.id,
        outletId: payload.outlet_id || payload.outletId || null,
      });
      const adjustments = [];
      for (const count of counts) {
        const item = await tx.inventoryItem.findFirstOrThrow({
          where: {
            id: count.inventory_id || count.inventoryItemId,
            businessId: business.id,
          },
        });
        const countedQuantity = Math.max(0, toNumber(count.counted_quantity ?? count.quantity, 0));
        const variance = countedQuantity - toNumber(item.stock, 0);
        if (variance !== 0) {
          await this.recordMovement({
            tx,
            businessId: business.id,
            item,
            movementType: "stock_audit_adjustment",
            quantity: variance,
            reason: payload.reason || `Stock audit by ${user?.name || "system"}`,
          });
        }
        adjustments.push({
          inventory_id: item.id,
          inventory_name: item.name,
          system_quantity: item.stock,
          counted_quantity: countedQuantity,
          variance,
        });
      }

      const record = await tx.purchaseOrder.create({
        data: {
          businessId: business.id,
          outletId,
          requestedById: user?.id || null,
          priority: "stock_audit",
          requiredBy: null,
          notes: JSON.stringify({
            type: "stock_audit",
            counted_by: user?.name || null,
            counted_at: nowIso(),
            reason: payload.reason || "",
          }),
          status: "stock_audit_completed",
          items: adjustments,
        },
      });

      return { record, adjustments };
    });

    await admincoreChangeSyncService.notifyChange({
      resource: "inventory",
      action: "stock_audit_completed",
      recordId: audit.record.id,
      tenantId,
      businessId: business.id,
      outletId: audit.record.outletId,
      metadata: {
        adjustment_count: audit.adjustments.length,
      },
    });

    return {
      record: serializePurchaseOrder(audit.record, tenantId),
      adjustments: audit.adjustments,
    };
  }

  async getCogsReport({ tenantId }) {
    const business = await ensureBusiness({ tenantId });
    const [products, bills, movements] = await Promise.all([
      prisma.product.findMany({ where: { businessId: business.id } }),
      prisma.bill.findMany({ where: { businessId: business.id }, include: { items: true } }),
      prisma.inventoryMovement.findMany({ where: { businessId: business.id } }),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const rows = new Map();

    for (const bill of bills) {
      for (const item of bill.items || []) {
        const product = productById.get(item.productId);
        const key = item.productId || item.name;
        const quantity = toNumber(item.quantity, 0);
        const revenue = quantity * toNumber(item.price, 0);
        const cost = quantity * toNumber(product?.costPrice, 0);
        const current = rows.get(key) || {
          product_id: item.productId,
          name: item.name,
          quantity_sold: 0,
          revenue: 0,
          cogs: 0,
          gross_profit: 0,
          margin_percent: 0,
        };
        current.quantity_sold += quantity;
        current.revenue += revenue;
        current.cogs += cost;
        current.gross_profit = current.revenue - current.cogs;
        current.margin_percent = current.revenue > 0 ? (current.gross_profit / current.revenue) * 100 : 0;
        rows.set(key, current);
      }
    }

    const wastageCost = movements
      .filter((movement) => ["wastage", "spoilage", "pilferage"].includes(movement.movementType))
      .reduce((sum, movement) => sum + Math.abs(toNumber(movement.quantity, 0)), 0);

    return {
      business_id: business.id,
      rows: Array.from(rows.values()),
      totals: Array.from(rows.values()).reduce(
        (summary, row) => ({
          revenue: summary.revenue + row.revenue,
          cogs: summary.cogs + row.cogs,
          gross_profit: summary.gross_profit + row.gross_profit,
          wastage_quantity: wastageCost,
        }),
        { revenue: 0, cogs: 0, gross_profit: 0, wastage_quantity: 0 },
      ),
    };
  }

  async getLowStockSuggestions({ tenantId }) {
    const business = await ensureBusiness({ tenantId });
    const items = await prisma.inventoryItem.findMany({
      where: { businessId: business.id },
      orderBy: { name: "asc" },
    });
    const suggestions = items
      .filter((item) => toNumber(item.stock, 0) <= toNumber(item.reorderLevel, 0))
      .map((item) => {
        const targetStock = Math.max(toNumber(item.reorderLevel, 0) * 2, toNumber(item.stock, 0) + 1);
        const suggestedQuantity = Math.max(0, targetStock - toNumber(item.stock, 0));
        return {
          inventory_id: item.id,
          inventory_name: item.name,
          vendor: item.vendor || null,
          current_stock: item.stock,
          reorder_level: item.reorderLevel,
          suggested_quantity: suggestedQuantity,
          unit: item.unit,
          estimated_cost: suggestedQuantity * toNumber(item.conversionCost, 0),
        };
      });

    return {
      business_id: business.id,
      generated_at: nowIso(),
      suggestions,
    };
  }
}

export const inventoryOperationsService = new InventoryOperationsService();
