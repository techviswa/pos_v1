import prisma from "../../database/prisma/client.js";
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

const DEFAULT_OUTLET_NAME = "Main Outlet";
const DEFAULT_OUTLET_CODE = "MAIN";
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const isRevenueBill = (bill) => !["void", "cancelled", "canceled"].includes(String(bill.status || "").toLowerCase());
const getNetBillRevenue = (bill) => Math.max(0, toNumber(bill.total, 0) - toNumber(bill.metadata?.refunded_amount, 0));

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

  async listOutlets({ tenantId, businessId }) {
    const business = await ensureBusiness({ tenantId, businessId });
    await this.ensureDefaultOutlet({ business });
    const recentActivityThreshold = new Date(Date.now() - 1000 * 60 * 60 * 24);
    const [outlets, purchaseOrderCounts, allocationCounts, orders, bills] = await Promise.all([
      prisma.outlet.findMany({
        where: { businessId: business.id },
        include: getOutletListInclude(),
        orderBy: { createdAt: "asc" },
      }),
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
      prisma.order.findMany({
        where: { businessId: business.id },
        select: {
          id: true,
          outletId: true,
          createdAt: true,
        },
      }),
      prisma.bill.findMany({
        where: { businessId: business.id },
        select: {
          orderId: true,
          status: true,
          total: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);

    const purchaseOrderMap = new Map(purchaseOrderCounts.map((entry) => [entry.outletId, entry._count._all]));
    const allocationMap = new Map(allocationCounts.map((entry) => [entry.outletId, entry._count._all]));
    const orderOutletMap = new Map();
    const outletSalesMap = new Map();
    const outletBillCountMap = new Map();
    const outletRecentActivityMap = new Map();

    orders.forEach((order) => {
      if (!order.outletId) {
        return;
      }

      orderOutletMap.set(order.id, order.outletId);

      if (order.createdAt >= recentActivityThreshold) {
        outletRecentActivityMap.set(
          order.outletId,
          (outletRecentActivityMap.get(order.outletId) || 0) + 1,
        );
      }
    });

    bills.filter(isRevenueBill).forEach((bill) => {
      const metadata = bill.metadata && typeof bill.metadata === "object" ? bill.metadata : {};
      const outletId =
        orderOutletMap.get(bill.orderId) ||
        metadata.outlet_id ||
        metadata.outletId ||
        null;
      if (!outletId) {
        return;
      }

      outletSalesMap.set(outletId, (outletSalesMap.get(outletId) || 0) + getNetBillRevenue(bill));
      outletBillCountMap.set(outletId, (outletBillCountMap.get(outletId) || 0) + 1);

      if (bill.createdAt >= recentActivityThreshold) {
        outletRecentActivityMap.set(outletId, (outletRecentActivityMap.get(outletId) || 0) + 1);
      }
    });

    return outlets.map((outlet) => {
      return {
        ...serializeOutlet(outlet),
        assigned_staff_count: outlet._count.userAssignments,
        product_count: outlet._count.productLinks,
        inventory_line_count: outlet._count.inventoryLinks,
        feature_count: outlet._count.featureToggles,
        analytics: {
          assigned_staff_count: outlet._count.userAssignments,
          active_product_count: outlet._count.productLinks,
          low_inventory_count: 0,
          enabled_feature_count: outlet._count.featureToggles,
          open_purchase_orders: purchaseOrderMap.get(outlet.id) || 0,
          allocations_count: allocationMap.get(outlet.id) || 0,
          total_sales: outletSalesMap.get(outlet.id) || 0,
          bill_count: outletBillCountMap.get(outlet.id) || 0,
          recent_activity_count: outletRecentActivityMap.get(outlet.id) || 0,
        },
      };
    });
  }

  buildOutletAnalytics({ outlet, purchaseOrderCount = 0, allocationCount = 0, billTotalsByOrderId = new Map() }) {
    const activeProducts = outlet.productLinks.filter((item) => item.enabled).length;
    const lowInventoryItems = outlet.inventoryLinks.filter(
      (item) => item.enabled && toNumber(item.stock, 0) <= toNumber(item.reorderLevel, 0),
    ).length;
    const enabledFeatures = outlet.featureToggles.filter((item) => item.enabled).length;
    const salesTotal = (outlet.orders || []).reduce(
      (sum, order) => sum + toNumber(billTotalsByOrderId.get(order.id), 0),
      0,
    );

    return {
      assigned_staff_count: outlet.userAssignments.length,
      active_product_count: activeProducts,
      low_inventory_count: lowInventoryItems,
      enabled_feature_count: enabledFeatures,
      open_purchase_orders: purchaseOrderCount,
      allocations_count: allocationCount,
      total_sales: salesTotal,
    };
  }

  async getOutletRecord({ tenantId, outletId }) {
    const business = await ensureBusiness({ tenantId });
    const outlet = await prisma.outlet.findFirstOrThrow({
      where: {
        id: outletId,
        businessId: business.id,
      },
      include: {
        ...getOutletInclude(),
        orders: true,
      },
    });

    return { business, outlet };
  }

  async getOutletById({ tenantId, outletId }) {
    const { business, outlet } = await this.getOutletRecord({ tenantId, outletId });
    const purchaseOrderCount = await prisma.purchaseOrder.count({
      where: {
        businessId: business.id,
        outletId,
        status: { in: ["pending", "approved"] },
      },
    });
    const allocationCount = await prisma.allocation.count({
      where: {
        businessId: business.id,
        outletId,
      },
    });
    const bills = await prisma.bill.findMany({
      where: {
        orderId: {
          in: outlet.orders.map((order) => order.id),
        },
      },
      select: {
        orderId: true,
        total: true,
      },
    });

    const billTotalsByOrderId = new Map(
      bills.filter(isRevenueBill).map((bill) => [bill.orderId, getNetBillRevenue(bill)]),
    );

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
        billTotalsByOrderId,
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

  async createOutlet({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const createdOutlet = await prisma.outlet.create({
      data: {
        businessId: business.id,
        name: payload.name || "New Outlet",
        code: payload.code || `OUT${Date.now()}`.slice(-8),
        location: payload.location || "",
        managerName: payload.manager_name || "",
        phone: payload.phone || "",
        status: payload.status || DEFAULT_OUTLET_STATUS,
      },
    });

    await syncOutletAssignments(createdOutlet.id, payload.assigned_user_ids || []);

    const [products, inventoryItems] = await Promise.all([
      prisma.product.findMany({ where: { businessId: business.id } }),
      prisma.inventoryItem.findMany({ where: { businessId: business.id } }),
    ]);

    if (products.length) {
      await prisma.outletProduct.createMany({
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
      await prisma.outletInventory.createMany({
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

    await prisma.outletFeatureToggle.createMany({
      data: FEATURE_REGISTRY.map((feature) => ({
        outletId: createdOutlet.id,
        featureKey: feature.key,
        enabled: true,
      })),
      skipDuplicates: true,
    });

    return this.getOutletById({
      tenantId,
      outletId: createdOutlet.id,
    });
  }

  async updateOutlet({ tenantId, outletId, payload }) {
    const { outlet } = await this.getOutletRecord({ tenantId, outletId });

    await prisma.outlet.update({
      where: { id: outletId },
      data: {
        name: payload.name ?? outlet.name,
        code: payload.code ?? outlet.code,
        location: payload.location ?? outlet.location,
        managerName: payload.manager_name ?? outlet.managerName,
        phone: payload.phone ?? outlet.phone,
        status: payload.status ?? outlet.status,
      },
    });

    if (payload.assigned_user_ids !== undefined) {
      await syncOutletAssignments(outletId, payload.assigned_user_ids || []);
    }

    return this.getOutletById({ tenantId, outletId });
  }

  async deleteOutlet({ tenantId, outletId }) {
    return this.updateOutlet({
      tenantId,
      outletId,
      payload: { status: "inactive" },
    });
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

    return this.listOutletStaff({ tenantId, outletId });
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

    return this.listOutletProducts({ tenantId, outletId });
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

    for (const item of items || []) {
      const inventoryItemId = item.inventory_id || item.inventoryItemId;
      if (!inventoryItemId) {
        continue;
      }

      const existingInventoryItem = await prisma.inventoryItem.findFirst({
        where: {
          id: inventoryItemId,
          businessId: business.id,
        },
      });

      if (!existingInventoryItem) {
        continue;
      }

      await prisma.outletInventory.upsert({
        where: {
          outletId_inventoryItemId: {
            outletId,
            inventoryItemId,
          },
        },
        update: {
          stock: item.stock !== undefined ? Number(item.stock) : undefined,
          reorderLevel: item.reorder_level !== undefined ? Number(item.reorder_level) : undefined,
          enabled: item.enabled ?? true,
        },
        create: {
          outletId,
          inventoryItemId,
          stock: Number(item.stock || 0),
          reorderLevel:
            item.reorder_level !== undefined
              ? Number(item.reorder_level)
              : Number(existingInventoryItem.reorderLevel || 0),
          enabled: item.enabled ?? true,
        },
      });
    }

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
    await this.getOutletRecord({ tenantId, outletId });

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

    return this.listOutletFeatures({ tenantId, outletId });
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
