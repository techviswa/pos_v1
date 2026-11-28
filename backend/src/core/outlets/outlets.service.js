import prisma from "../../database/prisma/client.js";
import { sqlTime } from "../../database/prisma/sql-time.js";
import { readSalesRollup } from "../dashboard/sales-rollup.js";
import { businessTimezone } from "../reports/report-scan.js";
import { readBusinessProfile } from "../businesses/business-profile.js";
import { Prisma } from "@prisma/client";
import { billFromSql, billOutletSql, billRevenueSql, isRevenueBillSql } from "../billing/bill-analytics.sql.js";
import { operationalWrite } from "../../shared/utils/operational-write.js";
import { moveStock } from "../inventory/stock-ledger.service.js";
import { assertOwnedIds } from "../../database/prisma/scope.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import {
  ensureBusiness,
  serializeOutlet,
  serializeOutletFeatureToggle,
  serializeOutletInventoryLink,
  serializeOutletProductLink,
  serializeOutletStaffAssignment,
  syncOutletAssignments,
} from "../../database/prisma/helpers.js";
import { DEFAULT_OUTLET_STATUS } from "../../shared/constants/domain.constants.js";
import { FEATURE_REGISTRY } from "../../shared/constants/feature.constants.js";
import {
  toAnalyticsNumber,
} from "../billing/bill-analytics.utils.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";
import { readState } from "../../database/prisma/state-store.js";

/**
 * An outlet can be closed only when nothing is left half-done there: its cash drawer shift is closed, no stock
 * transfer is on the way to or from it, and no bill is still waiting for payment. History is kept either way.
 */
const assertOutletCanClose = async ({ businessId, outletId }) => {
  const problems = [];
  const shift = await readState(`shift:${businessId}:${outletId}`);
  if (shift?.status === "open") problems.push("its cash drawer shift is still open (close it on the Cash drawer screen)");
  const moving = await prisma.allocation.count({ where: { businessId, status: { in: ["pending_approval", "approved"] }, OR: [{ outletId }, { sourceLocation: outletId }] } });
  if (moving) problems.push(`${moving} stock transfer(s) are not finished (approve or receive them in Central Kitchen)`);
  const unpaid = await prisma.bill.count({ where: { businessId, status: { notIn: ["void", "cancelled"] },
    AND: [{ metadata: { path: ["outlet_id"], equals: outletId } },
      { OR: [{ metadata: { path: ["payment_status"], equals: "unpaid" } }, { metadata: { path: ["payment_status"], equals: "partial_due" } }] }] } });
  if (unpaid) problems.push(`${unpaid} bill(s) still have money to collect (Bills screen)`);
  if (problems.length) throw createHttpError({ statusCode: 409, code: "OUTLET_NOT_READY_TO_CLOSE", message: `This outlet cannot be closed yet: ${problems.join("; ")}.` });
};

const DEFAULT_OUTLET_NAME = "Main Outlet";
const DEFAULT_OUTLET_CODE = "MAIN";

const normalizeOutletName = (value) => String(value || "").trim().toLowerCase();
const isGeneratedDefaultOutletCode = (value) => ["main", "mo1"].includes(String(value || "").trim().toLowerCase());

const getOutletInclude = () => ({
  business: true,
  userAssignments: {
    include: {
      user: {
        include: {
          role: true,
        },
      },
    },
  },
  productLinks: {
    include: {
      product: true,
    },
  },
  inventoryLinks: {
    include: {
      inventoryItem: true,
    },
  },
  featureToggles: true,
});

const getOutletListInclude = () => ({
  business: true,
  _count: {
    select: {
      userAssignments: true,
      productLinks: true,
      inventoryLinks: true,
      featureToggles: true,
    },
  },
});

class OutletsService {
  async provisionOutletDefaults({ business, outletId }) {
    const [products, inventoryItems, ownerManagerUsers] = await Promise.all([
      prisma.product.findMany({ where: { businessId: business.id } }),
      prisma.inventoryItem.findMany({ where: { businessId: business.id } }),
      prisma.user.findMany({
        where: {
          businessId: business.id,
          active: true,
          role: {
            name: {
              in: ["Owner", "Manager"],
            },
          },
        },
        select: { id: true },
      }),
    ]);

    if (products.length) {
      for (const product of products) {
        await prisma.outletProduct.upsert({
          where: {
            outletId_productId: {
              outletId,
              productId: product.id,
            },
          },
          update: {},
          create: {
            outletId,
            productId: product.id,
            enabled: true,
            priceOverride: null,
          },
        });
      }
    }

    if (inventoryItems.length) {
      for (const item of inventoryItems) {
        await prisma.outletInventory.upsert({
          where: {
            outletId_inventoryItemId: {
              outletId,
              inventoryItemId: item.id,
            },
          },
          update: {},
          create: {
            outletId,
            inventoryItemId: item.id,
            stock: 0,
            reorderLevel: item.reorderLevel || 0,
            enabled: true,
          },
        });
      }
    }

    if (FEATURE_REGISTRY.length) {
      for (const feature of FEATURE_REGISTRY) {
        await prisma.outletFeatureToggle.upsert({
          where: {
            outletId_featureKey: {
              outletId,
              featureKey: feature.key,
            },
          },
          update: {},
          create: {
            outletId,
            featureKey: feature.key,
            enabled: true,
          },
        });
      }
    }

    if (ownerManagerUsers.length) {
      await syncOutletAssignments(
        outletId,
        ownerManagerUsers.map((user) => user.id),
      );
    }
  }

  async ensureDefaultOutlet({ business }) {
    const outletCount = await prisma.outlet.count({
      where: { businessId: business.id },
    });

    if (outletCount > 0) {
      return null;
    }

    const outlet = await prisma.outlet.upsert({
      where: {
        businessId_code: {
          businessId: business.id,
          code: DEFAULT_OUTLET_CODE,
        },
      },
      update: {
        status: DEFAULT_OUTLET_STATUS,
      },
      create: {
        businessId: business.id,
        name: DEFAULT_OUTLET_NAME,
        code: DEFAULT_OUTLET_CODE,
        location: "",
        managerName: "",
        phone: "",
        status: DEFAULT_OUTLET_STATUS,
      },
    });

    await this.provisionOutletDefaults({ business, outletId: outlet.id });
    return outlet;
  }

  /**
   * Outlets of the business. includeSales adds all-time sales and bill counts per outlet (from the saved daily
   * totals); the plain list, which every screen loads, carries only the last 24 hours of activity.
   */
  async listOutlets({ tenantId, businessId, includeSales = false }) {
    const business = await ensureBusiness({ tenantId, businessId });
    await this.ensureDefaultOutlet({ business });
    const recentActivityThreshold = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const [outlets, productCount, inventoryCount, purchaseOrderCounts, allocationCounts, orders, bills] = await Promise.all([
      prisma.outlet.findMany({
        where: { businessId: business.id },
        include: getOutletListInclude(),
        orderBy: { createdAt: "asc" },
      }),
      prisma.product.count({ where: { businessId: business.id, active: true } }),
      prisma.inventoryItem.count({ where: { businessId: business.id } }),
      prisma.purchaseOrder.groupBy({
        by: ["outletId"],
        where: {
          businessId: business.id,
          status: { in: ["pending", "approved"] },
        },
        _count: { _all: true },
      }),
      prisma.allocation.groupBy({
        by: ["outletId"],
        where: { businessId: business.id },
        _count: { _all: true },
      }),
      // Activity and sales per outlet are summed in PostgreSQL: this list loads on every screen, so it must not
      // read every order and bill of the business.
      prisma.order.groupBy({ by: ["outletId"], where: { businessId: business.id, outletId: { not: null }, createdAt: { gte: recentActivityThreshold } }, _count: { _all: true } }),
      prisma.$queryRaw(Prisma.sql`SELECT ${billOutletSql} AS outlet_id, COUNT(*)::int AS recent
        FROM ${billFromSql} WHERE b."businessId" = ${business.id} AND b."createdAt" >= ${sqlTime(recentActivityThreshold)} AND ${isRevenueBillSql} GROUP BY 1`),
    ]);
    const sales = includeSales
      ? (await readSalesRollup({ businessId: business.id, timezone: businessTimezone(await readBusinessProfile(business.id)) })).outlets
      : null;

    const purchaseOrderMap = new Map(purchaseOrderCounts.map((entry) => [entry.outletId, entry._count._all]));
    const allocationMap = new Map(allocationCounts.map((entry) => [entry.outletId, entry._count._all]));
    const outletSalesMap = new Map();
    const outletBillCountMap = new Map();
    const outletRecentActivityMap = new Map();

    for (const row of orders) outletRecentActivityMap.set(row.outletId, row._count._all);
    for (const row of bills) if (row.outlet_id) outletRecentActivityMap.set(row.outlet_id, (outletRecentActivityMap.get(row.outlet_id) || 0) + row.recent);
    for (const [outletId, row] of sales || []) { outletSalesMap.set(outletId, row.revenue); outletBillCountMap.set(outletId, row.bills); }

    const outletNameCounts = outlets.reduce((counts, outlet) => {
      const name = normalizeOutletName(outlet.name);
      counts.set(name, (counts.get(name) || 0) + 1);
      return counts;
    }, new Map());

    // A generated duplicate "Main" outlet is hidden only if it never billed (checked just for those candidates).
    const candidates = outlets.filter((outlet) => (outletNameCounts.get(normalizeOutletName(outlet.name)) || 0) >= 2 && normalizeOutletName(outlet.name) === normalizeOutletName(DEFAULT_OUTLET_NAME) && isGeneratedDefaultOutletCode(outlet.code));
    for (const outlet of candidates) {
      if (outletBillCountMap.has(outlet.id)) continue;
      const [found] = await prisma.$queryRaw(Prisma.sql`SELECT EXISTS (SELECT 1 FROM ${billFromSql} WHERE b."businessId" = ${business.id} AND ${billOutletSql} = ${outlet.id}) AS billed`);
      if (found?.billed) outletBillCountMap.set(outlet.id, 1);
    }
    const shouldHideGeneratedDuplicate = (outlet) => {
      const name = normalizeOutletName(outlet.name);
      if ((outletNameCounts.get(name) || 0) < 2) return false;
      if (name !== normalizeOutletName(DEFAULT_OUTLET_NAME)) return false;
      if (!isGeneratedDefaultOutletCode(outlet.code)) return false;
      const hasOperationalData =
        outlet._count.productLinks > 0 ||
        outlet._count.inventoryLinks > 0 ||
        (outletBillCountMap.get(outlet.id) || 0) > 0 ||
        (outletRecentActivityMap.get(outlet.id) || 0) > 0 ||
        (purchaseOrderMap.get(outlet.id) || 0) > 0 ||
        (allocationMap.get(outlet.id) || 0) > 0;
      return !hasOperationalData;
    };

    return outlets.filter((outlet) => !shouldHideGeneratedDuplicate(outlet)).map((outlet) => {
      const activeProductCount = outlet._count.productLinks || productCount;
      const activeInventoryCount = outlet._count.inventoryLinks || inventoryCount;
      return {
        ...serializeOutlet(outlet),
        assigned_staff_count: outlet._count.userAssignments,
        product_count: activeProductCount,
        inventory_line_count: activeInventoryCount,
        feature_count: outlet._count.featureToggles,
        analytics: {
          assigned_staff_count: outlet._count.userAssignments,
          active_product_count: activeProductCount,
          low_inventory_count: 0,
          enabled_feature_count: outlet._count.featureToggles,
          open_purchase_orders: purchaseOrderMap.get(outlet.id) || 0,
          allocations_count: allocationMap.get(outlet.id) || 0,
          // Only in the sales view (?analytics=1); the everyday list leaves these out rather than showing zero.
          ...(includeSales ? { total_sales: outletSalesMap.get(outlet.id) || 0, bill_count: outletBillCountMap.get(outlet.id) || 0 } : {}),
          recent_activity_count: outletRecentActivityMap.get(outlet.id) || 0,
        },
      };
    });
  }

  buildOutletAnalytics({ outlet, purchaseOrderCount = 0, allocationCount = 0, salesTotal = null }) {
    const activeProducts = outlet.productLinks.filter((item) => item.enabled).length;
    const lowInventoryItems = outlet.inventoryLinks.filter(
      (item) => item.enabled && toAnalyticsNumber(item.stock, 0) <= toAnalyticsNumber(item.reorderLevel, 0),
    ).length;
    const enabledFeatures = outlet.featureToggles.filter((item) => item.enabled).length;
    const resolvedSalesTotal = salesTotal ?? 0;

    return {
      assigned_staff_count: outlet.userAssignments.length,
      active_product_count: activeProducts,
      low_inventory_count: lowInventoryItems,
      enabled_feature_count: enabledFeatures,
      open_purchase_orders: purchaseOrderCount,
      allocations_count: allocationCount,
      total_sales: resolvedSalesTotal,
    };
  }

  async getOutletRecord({ tenantId, outletId, client = prisma }) {
    const business = await ensureBusiness({ tenantId });
    const outlet = await client.outlet.findFirstOrThrow({
      where: {
        id: outletId,
        businessId: business.id,
      },
      include: {
        ...getOutletInclude(),
      },
    });

    return { business, outlet };
  }

  async getOutletById({ tenantId, outletId, client = prisma }) {
    const { business, outlet } = await this.getOutletRecord({ tenantId, outletId, client });
    const purchaseOrderCount = await client.purchaseOrder.count({
      where: {
        businessId: business.id,
        outletId,
        status: { in: ["pending", "approved"] },
      },
    });
    const allocationCount = await client.allocation.count({
      where: {
        businessId: business.id,
        outletId,
      },
    });
    // This outlet's all-time sales from the saved daily totals (same rules as Reports).
    const sales = { total: (await readSalesRollup({ businessId: business.id, timezone: businessTimezone(await readBusinessProfile(business.id)), outletId })).revenue };

    return {
      ...serializeOutlet(outlet),
      staff_assignments: outlet.userAssignments.map(serializeOutletStaffAssignment),
      products: outlet.productLinks.map(serializeOutletProductLink),
      inventory: outlet.inventoryLinks.map(serializeOutletInventoryLink),
      features: this.mergeOutletFeatures(outlet.featureToggles),
      analytics: this.buildOutletAnalytics({
        outlet,
        purchaseOrderCount,
        allocationCount,
        salesTotal: sales.total,
      }),
    };
  }

  mergeOutletFeatures(featureToggles = []) {
    const toggleMap = new Map(featureToggles.map((toggle) => [toggle.featureKey, toggle]));
    return FEATURE_REGISTRY.map((feature) => {
      const toggle = toggleMap.get(feature.key);
      return {
        feature_key: feature.key,
        label: feature.label,
        domain: feature.domain,
        description: feature.description,
        enabled: toggle?.enabled ?? false,
      };
    });
  }

  async createOutlet({ tenantId, payload, transaction = null, sourceOutletId = null, commandId = null }) {
    const business = await ensureBusiness({ tenantId });
    const work = async tx => {
      if (sourceOutletId) {
        const existing = await tx.outlet.findUnique({ where: { id: sourceOutletId } });
        if (existing) {
          if (existing.businessId !== business.id) throw createHttpError({ statusCode: 409, code: "OUTLET_IDENTITY_CONFLICT", message: "Outlet identity belongs to another business" });
          return { id: existing.id };
        }
      }
      const createdOutlet = await tx.outlet.create({
        data: {
          ...(sourceOutletId ? { id: sourceOutletId } : {}),
          businessId: business.id,
          name: payload.name || "New Outlet",
          code: payload.code || `OUT${Date.now()}`.slice(-8),
          location: payload.location || "",
          managerName: payload.manager_name || "",
          phone: payload.phone || "",
          status: payload.status || DEFAULT_OUTLET_STATUS,
        },
      });

      await syncOutletAssignments(createdOutlet.id, await assertOwnedIds({ kind: "user", ids: payload.assigned_user_ids, businessId: business.id, client: tx }), tx);

      const [products, inventoryItems] = await Promise.all([
        tx.product.findMany({ where: { businessId: business.id } }),
        tx.inventoryItem.findMany({ where: { businessId: business.id } }),
      ]);

      if (products.length) {
        await tx.outletProduct.createMany({
          data: products.map((product) => ({
            outletId: createdOutlet.id,
            productId: product.id,
            enabled: true,
            priceOverride: null,
          })),
          skipDuplicates: true,
        });
      }

      if (inventoryItems.length) {
        await tx.outletInventory.createMany({
          data: inventoryItems.map((item) => ({
            outletId: createdOutlet.id,
            inventoryItemId: item.id,
            stock: 0,
            reorderLevel: item.reorderLevel || 0,
            enabled: true,
          })),
          skipDuplicates: true,
        });
      }

      await tx.outletFeatureToggle.createMany({
        data: FEATURE_REGISTRY.map((feature) => ({
          outletId: createdOutlet.id,
          featureKey: feature.key,
          enabled: true,
        })),
        skipDuplicates: true,
      });

      const outlet = createdOutlet;
      await admincoreChangeSyncService.notifyChange({
        resource: "outlets",
        action: "created",
        recordId: outlet.id,
        tenantId,
        businessId: business.id,
        outletId: outlet.id,
        metadata: {
          name: outlet.name,
          code: outlet.code,
          status: outlet.status,
        },
      }, { tx });

      return { id: outlet.id };
    };
    const result = transaction ? await work(transaction) : await operationalWrite({
      businessId: business.id, kind: "outlet-create", payload: { ...payload, ...(commandId ? { request_id: commandId } : {}) },
    }, work);
    return this.getOutletById({ tenantId, outletId: result.id, client: transaction || prisma });
  }

  async updateOutlet({ tenantId, outletId, payload, commandId = null, expectedUpdatedAt = null }) {
    const { business, outlet } = await this.getOutletRecord({ tenantId, outletId });
    const nextStatus = payload.status ?? outlet.status;
    if (outlet.status === "active" && nextStatus !== "active") await assertOutletCanClose({ businessId: business.id, outletId });
    if (outlet.status !== "active" && nextStatus === "active") {
      // Reopening takes a plan slot again (closed outlets do not count).
      const { saasService } = await import("../saas/saas.service.js");
      await saasService.assertWithinLimit({ businessId: business.id, resource: "outlets", increment: 1 });
    }
    await operationalWrite({ businessId: business.id, kind: `outlet-update:${outletId}`,
      payload: { ...payload, ...(commandId ? { request_id: commandId } : {}) } }, async tx => {
      const changed = await tx.outlet.updateMany({
        where: { id: outletId, businessId: business.id, updatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : outlet.updatedAt },
        data: {
          name: payload.name ?? outlet.name,
          code: payload.code ?? outlet.code,
          location: payload.location ?? outlet.location,
          managerName: payload.manager_name ?? outlet.managerName,
          phone: payload.phone ?? outlet.phone,
          status: payload.status ?? outlet.status,
        },
      });
      if (changed.count !== 1) throw createHttpError({ statusCode: 409, code: "OUTLET_VERSION_CONFLICT", message: "The outlet changed while you were editing. Reload it before saving." });
      if (payload.assigned_user_ids !== undefined) {
        const ids = await assertOwnedIds({ kind: "user", ids: payload.assigned_user_ids, businessId: business.id, client: tx });
        await syncOutletAssignments(outletId, ids, tx);
      }
      await admincoreChangeSyncService.notifyChange({ resource: "outlets", action: "updated", recordId: outletId,
        tenantId, businessId: business.id, outletId,
        metadata: { name: payload.name ?? outlet.name, code: payload.code ?? outlet.code, status: payload.status ?? outlet.status },
      }, { tx });
      return { id: outletId };
    });
    return this.getOutletById({ tenantId, outletId });
  }

  async deleteOutlet({ tenantId, outletId, commandId = null, expectedUpdatedAt = null }) {
    return this.updateOutlet({ tenantId, outletId, commandId, expectedUpdatedAt, payload: { status: "inactive" } });
  }

  async assignUsers({ tenantId, outletId, userIds }) {
    const { business } = await this.getOutletRecord({ tenantId, outletId });
    const validUserIds = await prisma.user.findMany({
      where: {
        businessId: business.id,
        id: { in: userIds || [] },
      },
      select: { id: true },
    });

    await syncOutletAssignments(
      outletId,
      validUserIds.map((user) => user.id),
    );

    const staff = await this.listOutletStaff({ tenantId, outletId });
    await admincoreChangeSyncService.notifyChange({
      resource: "outlets",
      action: "staff_assigned",
      recordId: outletId,
      tenantId,
      businessId: business.id,
      outletId,
      metadata: {
        assigned_user_count: staff.length,
      },
    });

    return staff;
  }

  async listOutletStaff({ tenantId, outletId }) {
    const { outlet } = await this.getOutletRecord({ tenantId, outletId });
    return outlet.userAssignments.map(serializeOutletStaffAssignment);
  }

  async updateOutletProducts({ tenantId, outletId, items = [] }) {
    const { business } = await this.getOutletRecord({ tenantId, outletId });

    for (const item of items || []) {
      const productId = item.product_id || item.productId;
      if (!productId) {
        continue;
      }

      const existingProduct = await prisma.product.findFirst({
        where: {
          id: productId,
          businessId: business.id,
        },
      });

      if (!existingProduct) {
        continue;
      }

      await prisma.outletProduct.upsert({
        where: {
          outletId_productId: {
            outletId,
            productId,
          },
        },
        update: {
          enabled: item.enabled ?? true,
          priceOverride:
            item.price_override !== undefined && item.price_override !== null && item.price_override !== ""
              ? Number(item.price_override)
              : null,
        },
        create: {
          outletId,
          productId,
          enabled: item.enabled ?? true,
          priceOverride:
            item.price_override !== undefined && item.price_override !== null && item.price_override !== ""
              ? Number(item.price_override)
              : null,
        },
      });
    }

    const products = await this.listOutletProducts({ tenantId, outletId });
    await admincoreChangeSyncService.notifyChange({
      resource: "outlets",
      action: "products_updated",
      recordId: outletId,
      tenantId,
      businessId: business.id,
      outletId,
      metadata: {
        product_count: products.length,
      },
    });

    return products;
  }

  async listOutletProducts({ tenantId, outletId }) {
    const { business } = await this.getOutletRecord({ tenantId, outletId });

    const [products, links] = await Promise.all([
      prisma.product.findMany({
        where: { businessId: business.id },
        orderBy: { name: "asc" },
      }),
      prisma.outletProduct.findMany({
        where: { outletId },
        include: { product: true },
      }),
    ]);

    const linkMap = new Map(links.map((link) => [link.productId, link]));

    return products.map((product) =>
      serializeOutletProductLink(
        linkMap.get(product.id) || {
          id: `virtual_${outletId}_${product.id}`,
          outletId,
          productId: product.id,
          enabled: false,
          priceOverride: null,
          product,
        },
      ),
    );
  }

  async updateOutletInventory({ tenantId, outletId, items = [] }) {
    const { business } = await this.getOutletRecord({ tenantId, outletId });
    await prisma.$transaction(async (tx) => {
      for (const item of [...items].sort((a, b) => String(a.inventory_id || a.inventoryItemId).localeCompare(String(b.inventory_id || b.inventoryItemId)))) {
        const inventoryItemId = item.inventory_id || item.inventoryItemId;
        if (typeof inventoryItemId !== "string" || !inventoryItemId) throw createHttpError({ statusCode: 400, message: "An inventory item ID is required" });
        await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${inventoryItemId} AND "businessId" = ${business.id} FOR UPDATE`;
        const ingredient = await tx.inventoryItem.findFirst({ where: { id: inventoryItemId, businessId: business.id } });
        if (!ingredient) throw createHttpError({ statusCode: 404, message: "Inventory item not found in this business" });
        for (const field of ["stock", "reorder_level"]) {
          if (item[field] != null && (String(item[field]).trim() === "" || !Number.isFinite(Number(item[field])) || Number(item[field]) < 0)) throw createHttpError({ statusCode: 400, message: "Stock and reorder level must be non-negative numbers" });
        }
        const balance = await tx.outletInventory.findUnique({ where: { outletId_inventoryItemId: { outletId, inventoryItemId } } });
        if (item.stock != null && Number(item.stock) !== (balance?.stock || 0)) {
          await moveStock({ tx, businessId: business.id, itemId: inventoryItemId, outletId,
            quantity: Number(item.stock) - (balance?.stock || 0), movementType: "stock_audit_adjustment", reason: "Outlet inventory count" });
        }
        await tx.outletInventory.upsert({ where: { outletId_inventoryItemId: { outletId, inventoryItemId } },
          update: { reorderLevel: item.reorder_level != null ? Number(item.reorder_level) : undefined, enabled: item.enabled ?? true },
          create: { outletId, inventoryItemId, stock: 0, reorderLevel: Number(item.reorder_level ?? ingredient.reorderLevel), enabled: item.enabled ?? true } });
      }
      await admincoreChangeSyncService.notifyChange({ resource: "outlets", action: "inventory_updated",
        recordId: outletId, tenantId, businessId: business.id, outletId, metadata: { inventory_line_count: items.length } }, { tx });
    });
    return this.listOutletInventory({ tenantId, outletId });
  }

  async listOutletInventory({ tenantId, outletId }) {
    const { business } = await this.getOutletRecord({ tenantId, outletId });

    const [inventoryItems, links] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { businessId: business.id },
        orderBy: { name: "asc" },
      }),
      prisma.outletInventory.findMany({
        where: { outletId },
        include: { inventoryItem: true },
      }),
    ]);

    const linkMap = new Map(links.map((link) => [link.inventoryItemId, link]));

    return inventoryItems.map((inventoryItem) =>
      serializeOutletInventoryLink(
        linkMap.get(inventoryItem.id) || {
          id: `virtual_${outletId}_${inventoryItem.id}`,
          outletId,
          inventoryItemId: inventoryItem.id,
          stock: 0,
          reorderLevel: inventoryItem.reorderLevel || 0,
          enabled: false,
          inventoryItem,
        },
      ),
    );
  }

  async updateOutletFeatures({ tenantId, outletId, items = [] }) {
    const { outlet } = await this.getOutletRecord({ tenantId, outletId });

    for (const item of items || []) {
      const featureKey = item.feature_key || item.featureKey;
      if (!featureKey) {
        continue;
      }

      await prisma.outletFeatureToggle.upsert({
        where: {
          outletId_featureKey: {
            outletId,
            featureKey,
          },
        },
        update: {
          enabled: item.enabled ?? false,
        },
        create: {
          outletId,
          featureKey,
          enabled: item.enabled ?? false,
        },
      });
    }

    const features = await this.listOutletFeatures({ tenantId, outletId });
    await admincoreChangeSyncService.notifyChange({
      resource: "outlets",
      action: "features_updated",
      recordId: outletId,
      tenantId,
      businessId: outlet.businessId,
      outletId,
      metadata: {
        feature_count: features.length,
      },
    });

    return features;
  }

  async listOutletFeatures({ tenantId, outletId }) {
    const { outlet } = await this.getOutletRecord({ tenantId, outletId });
    return this.mergeOutletFeatures(outlet.featureToggles).map((item) => ({
      ...item,
      ...(outlet.featureToggles.find((toggle) => toggle.featureKey === item.feature_key)
        ? serializeOutletFeatureToggle(
            outlet.featureToggles.find((toggle) => toggle.featureKey === item.feature_key),
          )
        : {}),
      feature_key: item.feature_key,
      label: item.label,
      domain: item.domain,
      description: item.description,
      enabled: item.enabled,
    }));
  }
}

export const outletsService = new OutletsService();
