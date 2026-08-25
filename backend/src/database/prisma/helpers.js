import env from "../../config/env.js";
import prisma from "./client.js";
import {
  DEFAULT_BILLING_CURRENCY,
  DEFAULT_CUSTOMER_NAME,
  DEFAULT_INVENTORY_UNIT,
  DEFAULT_OUTLET_STATUS,
  DEFAULT_PRODUCT_CATEGORY,
  DEFAULT_PRODUCT_DIETARY_TYPE,
  DEFAULT_USER_ROLE,
} from "../../shared/constants/domain.constants.js";
import {
  ROLE_DEFAULT_PERMISSIONS,
  STAFF_PERMISSION_KEYS,
} from "../../shared/constants/access.constants.js";
import { FEATURE_REGISTRY } from "../../shared/constants/feature.constants.js";
import { normalizeBillingMetadata } from "../../core/billing/billing-metadata.utils.js";

const businessCache = new Map();
const roleCache = new Map();
let accessControlSeedPromise = null;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const cloneJson = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
};

const toIso = (value) => (value ? value.toISOString() : null);
const getTenantId = (record) => record.business?.tenantId || env.defaultTenantId;
const syncFields = ({ record, tenantId, businessId, outletId, resource }) => ({
  tenant_id: tenantId || getTenantId(record),
  business_id: businessId || record.businessId || record.id || null,
  ...(outletId || record.outletId ? { outlet_id: outletId || record.outletId } : {}),
  sync_source: "pos-core",
  sync_resource: resource,
  last_synced_at: toIso(record.updatedAt || record.createdAt) || new Date().toISOString(),
});

export const ensureBusiness = async ({
  tenantId = env.defaultTenantId,
  businessId = env.defaultBusinessId,
} = {}) => {
  const normalizedTenantId = String(tenantId || env.defaultTenantId);
  const normalizedBusinessId = String(businessId || env.defaultBusinessId);
  const cacheKey = `${normalizedTenantId}:${normalizedBusinessId}`;

  if (businessCache.has(cacheKey)) {
    return businessCache.get(cacheKey);
  }

  const businessPromise = prisma.business
    .findUnique({
      where: { tenantId: normalizedTenantId },
    })
    .then((existingBusiness) => {
      if (existingBusiness) {
        return existingBusiness;
      }

      return prisma.business.create({
        data: {
          id: normalizedBusinessId,
          tenantId: normalizedTenantId,
          name: "Demo POS Business",
        },
      });
    })
    .catch((error) => {
      businessCache.delete(cacheKey);
      throw error;
    });

  businessCache.set(cacheKey, businessPromise);
  return businessPromise;
};

export const findBusinessById = async (businessId) => {
  if (!businessId) {
    return null;
  }

  return prisma.business.findUnique({
    where: { id: String(businessId) },
  });
};

export const ensurePermissions = async (permissionKeys = []) => {
  const uniqueKeys = [...new Set(permissionKeys.filter(Boolean))];

  await Promise.all(
    uniqueKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: { label: key },
        create: { key, label: key },
      }),
    ),
  );

  return prisma.permission.findMany({
    where: { key: { in: uniqueKeys } },
  });
};

export const ensureRole = async (roleName = DEFAULT_USER_ROLE) => {
  const resolvedRoleName = String(roleName || DEFAULT_USER_ROLE);

  if (roleCache.has(resolvedRoleName)) {
    return roleCache.get(resolvedRoleName);
  }

  const rolePromise = prisma.role
    .upsert({
      where: { name: resolvedRoleName },
      update: {},
      create: { name: resolvedRoleName },
    })
    .then(async (role) => {
      const defaultPermissionKeys = ROLE_DEFAULT_PERMISSIONS[resolvedRoleName] || [];
      const permissions = await ensurePermissions(defaultPermissionKeys);

      await Promise.all(
        permissions.map((permission) =>
          prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId: permission.id,
              },
            },
            update: {},
            create: {
              roleId: role.id,
              permissionId: permission.id,
            },
          }),
        ),
      );

      return prisma.role.findUnique({
        where: { id: role.id },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });
    })
    .catch((error) => {
      roleCache.delete(resolvedRoleName);
      throw error;
    });

  roleCache.set(resolvedRoleName, rolePromise);
  return rolePromise;
};

export const ensureAccessControlSeed = async () => {
  if (!accessControlSeedPromise) {
    accessControlSeedPromise = (async () => {
      await ensurePermissions(STAFF_PERMISSION_KEYS);
      await Promise.all(Object.keys(ROLE_DEFAULT_PERMISSIONS).map((roleName) => ensureRole(roleName)));
    })().catch((error) => {
      accessControlSeedPromise = null;
      throw error;
    });
  }

  await accessControlSeedPromise;
};

export const syncUserPermissions = async (userId, permissionKeys = []) => {
  const permissions = await ensurePermissions(permissionKeys);

  await prisma.userPermission.deleteMany({
    where: { userId },
  });

  if (!permissions.length) {
    return;
  }

  await prisma.userPermission.createMany({
    data: permissions.map((permission) => ({
      userId,
      permissionId: permission.id,
    })),
  });
};

export const syncUserOutlets = async (userId, outletIds = []) => {
  const uniqueOutletIds = [...new Set((outletIds || []).filter(Boolean))];

  await prisma.userOutletAssignment.deleteMany({
    where: { userId },
  });

  if (!uniqueOutletIds.length) {
    return;
  }

  await Promise.all(
    uniqueOutletIds.map((outletId) =>
      prisma.userOutletAssignment.upsert({
        where: {
          userId_outletId: {
            userId,
            outletId,
          },
        },
        update: {},
        create: {
          userId,
          outletId,
        },
      }),
    ),
  );
};

export const syncOutletAssignments = async (outletId, userIds = []) => {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];

  await prisma.userOutletAssignment.deleteMany({
    where: { outletId },
  });

  if (!uniqueUserIds.length) {
    return;
  }

  await Promise.all(
    uniqueUserIds.map((userId) =>
      prisma.userOutletAssignment.upsert({
        where: {
          userId_outletId: {
            userId,
            outletId,
          },
        },
        update: {},
        create: {
          userId,
          outletId,
        },
      }),
    ),
  );
};

export const syncProductVariations = async (productId, variations = []) => {
  await prisma.variation.deleteMany({
    where: { productId },
  });

  if (!(variations || []).length) {
    return;
  }

  await prisma.variation.createMany({
    data: variations.map((variation) => ({
      productId,
      name: variation.name || variation.label || "Variation",
      price: toNumber(variation.price, 0),
      recipeLines: cloneJson(variation.recipe_lines ?? variation.recipeLines ?? [], []),
    })),
  });
};

export const syncProductAddons = async (productId, addons = []) => {
  await prisma.addon.deleteMany({
    where: { productId },
  });

  if (!(addons || []).length) {
    return;
  }

  await prisma.addon.createMany({
    data: addons.map((addon) => ({
      productId,
      linkedProductId: addon.linked_product_id || addon.linkedProductId || null,
      name: addon.name || "Addon",
      price: toNumber(addon.price, 0),
      recipeLines: cloneJson(addon.recipe_lines ?? addon.recipeLines ?? [], []),
    })),
  });
};

export const serializeBusiness = (business) => ({
  id: business.id,
  tenantId: business.tenantId,
  tenant_id: business.tenantId,
  business_id: business.id,
  pos_business_id: business.id,
  admincore_client_id: business.tenantId,
  admincore_business_id: business.id,
  name: business.name,
  type: "restaurant",
  plan: "starter",
  status: "active",
  user_count: business.users?.length || 0,
  outlet_count: business.outlets?.length || 0,
  created_at: toIso(business.createdAt),
  updated_at: toIso(business.updatedAt),
  sync_source: "pos-core",
  sync_resource: "businesses",
  last_synced_at: toIso(business.updatedAt || business.createdAt) || new Date().toISOString(),
});
export const serializeUser = (user) => ({
  id: user.id,
  tenantId: user.business?.tenantId || env.defaultTenantId,
  ...syncFields({ record: user, resource: "staff" }),
  staff_id: user.id,
  name: user.name,
  email: user.email,
  role: user.role?.name || DEFAULT_USER_ROLE,
  permissions: user.permissions?.map((entry) => entry.permission.key) || [],
  profile_required: user.profileRequired,
  assigned_outlet_ids: user.outletAssignments?.map((assignment) => assignment.outletId) || [],
  active: user.active,
  bio: cloneJson(user.bio, null),
  created_at: toIso(user.createdAt),
  updated_at: toIso(user.updatedAt),
});

export const serializeOutlet = (outlet) => ({
  id: outlet.id,
  tenantId: outlet.business?.tenantId || env.defaultTenantId,
  ...syncFields({ record: outlet, resource: "outlets" }),
  outlet_id: outlet.id,
  name: outlet.name,
  code: outlet.code,
  location: outlet.location || "",
  manager_name: outlet.managerName || "",
  phone: outlet.phone || "",
  status: outlet.status || DEFAULT_OUTLET_STATUS,
  assigned_user_ids: outlet.userAssignments?.map((assignment) => assignment.userId) || [],
  created_at: toIso(outlet.createdAt),
  updated_at: toIso(outlet.updatedAt),
});

export const serializeOutletStaffAssignment = (assignment) => ({
  user_id: assignment.user.id,
  name: assignment.user.name,
  email: assignment.user.email,
  role: assignment.user.role?.name || DEFAULT_USER_ROLE,
  active: assignment.user.active,
});

export const serializeOutletProductLink = (link) => ({
  id: link.id,
  product_id: link.productId,
  product_name: link.product?.name || "Product",
  enabled: link.enabled,
  price_override: link.priceOverride,
  base_price: link.product?.price ?? 0,
  effective_price: link.priceOverride ?? link.product?.price ?? 0,
  category: link.product?.category || DEFAULT_PRODUCT_CATEGORY,
});

export const serializeOutletInventoryLink = (link) => ({
  id: link.id,
  inventory_id: link.inventoryItemId,
  inventory_name: link.inventoryItem?.name || "Inventory Item",
  unit: link.inventoryItem?.unit || DEFAULT_INVENTORY_UNIT,
  stock: link.stock,
  reorder_level: link.reorderLevel,
  enabled: link.enabled,
  central_stock: link.inventoryItem?.stock ?? 0,
  conversion_cost: link.inventoryItem?.conversionCost ?? 0,
});

export const serializeOutletFeatureToggle = (toggle) => ({
  id: toggle.id,
  feature_key: toggle.featureKey,
  enabled: toggle.enabled,
  label: FEATURE_REGISTRY.find((feature) => feature.key === toggle.featureKey)?.label || toggle.featureKey,
});

export const serializeProduct = (product) => ({
  id: product.id,
  tenantId: product.business?.tenantId || env.defaultTenantId,
  ...syncFields({ record: product, resource: "products" }),
  product_id: product.id,
  name: product.name,
  price: product.price,
  cost_price: product.costPrice,
  stock: product.stock,
  active: product.active,
  category: product.category || DEFAULT_PRODUCT_CATEGORY,
  dietary_type: product.dietaryType || DEFAULT_PRODUCT_DIETARY_TYPE,
  variation_options:
    product.variations?.map((variation) => ({
      id: variation.id,
      name: variation.name,
      price: variation.price,
      recipe_lines: cloneJson(variation.recipeLines, []),
    })) || [],
  addon_options:
    product.addons?.map((addon) => ({
      id: addon.id,
      linked_product_id: addon.linkedProductId,
      name: addon.name,
      price: addon.price,
      recipe_lines: cloneJson(addon.recipeLines, []),
    })) || [],
  recipe_lines: cloneJson(product.recipeLines, []),
  channel_settings: cloneJson(product.channelSettings, {}),
  outlet_overrides: cloneJson(product.outletOverrides, []),
  removal_options: cloneJson(product.removalOptions, []),
  created_at: toIso(product.createdAt),
  updated_at: toIso(product.updatedAt),
});

export const serializeOrder = (order) => ({
  id: order.id,
  tenantId: order.business?.tenantId || env.defaultTenantId,
  ...syncFields({ record: order, resource: "orders" }),
  order_id: order.id,
  tracking_token: order.trackingToken || order.metadata?.tracking_token || null,
  customerName: order.customerName || DEFAULT_CUSTOMER_NAME,
  channel: order.channel,
  total: order.total,
  status: order.status,
  metadata: cloneJson(order.metadata, {}),
  items:
    order.items?.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      variation: item.variation,
      addons: cloneJson(item.addons, []),
    })) || [],
  created_at: toIso(order.createdAt),
  updated_at: toIso(order.updatedAt),
});

export const serializeBill = (bill) => ({
  id: bill.id,
  tenantId: bill.business?.tenantId || env.defaultTenantId,
  business_id: bill.businessId,
  order_id: bill.orderId,
  customerName: bill.customerName || DEFAULT_CUSTOMER_NAME,
  currency: bill.currency || DEFAULT_BILLING_CURRENCY,
  subtotal: bill.subtotal,
  tax: bill.tax,
  total: bill.total,
  status: bill.status,
  kitchen_status: bill.kitchenStatus || null,
  created_at: bill.createdAt ? bill.createdAt.toISOString() : null,
  updated_at: bill.updatedAt ? bill.updatedAt.toISOString() : null,
  items:
    bill.items?.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      variation: item.variation,
      addons: cloneJson(item.addons, []),
    })) || [],
  ...normalizeBillingMetadata(bill.metadata || {}),
});

export const serializeInventoryItem = (item) => ({
  id: item.id,
  tenantId: item.business?.tenantId || env.defaultTenantId,
  ...syncFields({ record: item, resource: "inventory" }),
  inventory_id: item.id,
  name: item.name,
  stock: item.stock,
  unit: item.unit || DEFAULT_INVENTORY_UNIT,
  reorderLevel: item.reorderLevel,
  vendor: item.vendor || "",
  storage_location: item.storageLocation || "",
  notes: item.notes || "",
  expiry_date: toIso(item.expiryDate),
  conversion_cost: item.conversionCost,
  created_at: toIso(item.createdAt),
  updated_at: toIso(item.updatedAt),
});

export const serializePurchaseOrder = (purchaseOrder, tenantId = env.defaultTenantId) => ({
  id: purchaseOrder.id,
  tenantId,
  outletId: purchaseOrder.outletId,
  requestedById: purchaseOrder.requestedById,
  priority: purchaseOrder.priority || null,
  requiredBy: purchaseOrder.requiredBy ? purchaseOrder.requiredBy.toISOString() : null,
  notes: purchaseOrder.notes || "",
  status: purchaseOrder.status,
  items: cloneJson(purchaseOrder.items, []),
});

export const serializeAllocation = (allocation, tenantId = env.defaultTenantId) => ({
  id: allocation.id,
  tenantId,
  outletId: allocation.outletId,
  purchaseOrderId: allocation.purchaseOrderId || null,
  routePlanId: allocation.routePlanId,
  sourceLocation: allocation.sourceLocation,
  status: allocation.status,
  items: cloneJson(allocation.items, []),
});

export const serializeRoutePlan = (routePlan, tenantId = env.defaultTenantId) => ({
  id: routePlan.id,
  tenantId,
  routeName: routePlan.routeName,
  dispatchDate: routePlan.dispatchDate ? routePlan.dispatchDate.toISOString() : null,
  driverName: routePlan.driverName || "",
  vehicleNumber: routePlan.vehicleNumber || "",
  status: routePlan.status,
  stops:
    routePlan.stops?.map((stop) => ({
      id: stop.id,
      outletId: stop.outletId,
      sequence: stop.sequence,
      eta: stop.eta || null,
    })) || [],
});

export const serializeKitchenTicket = (ticket, tenantId = env.defaultTenantId) => ({
  id: ticket.id,
  tenantId,
  orderId: ticket.orderId,
  status: ticket.status,
});

export const serializeBatch = (batch, tenantId = env.defaultTenantId) => ({
  id: batch.id,
  tenantId,
  sku: batch.sku,
  batchNo: batch.batchNo,
  expiryDate: batch.expiryDate.toISOString(),
});

export const serializeTable = (table, tenantId = env.defaultTenantId) => ({
  id: table.id,
  tenantId,
  name: table.name,
  seats: table.seats,
  status: table.status,
});

export const serializeReservation = (reservation, tenantId = env.defaultTenantId) => ({
  id: reservation.id,
  tenantId,
  tableId: reservation.tableId,
  customerName: reservation.customerName || null,
  reservationDate: reservation.reservationDate ? reservation.reservationDate.toISOString() : null,
  status: reservation.status,
  guestsCount: reservation.guestsCount,
  notes: reservation.notes || "",
});

export const toPrismaOrderItems = (items = []) =>
  (items || []).map((item) => ({
    productId: item.productId || item.product_id || null,
    name: item.name || "Item",
    quantity: Math.max(1, Number(item.quantity || 1)),
    price: toNumber(item.price, 0),
    variation: item.variation || null,
    addons: cloneJson(item.addons, []),
  }));

export const toPrismaBillItems = (items = []) =>
  (items || []).map((item) => ({
    productId: item.productId || item.product_id || null,
    name: item.name || "Item",
    quantity: Math.max(1, Number(item.quantity || 1)),
    price: toNumber(item.price, 0),
    variation: item.variation || null,
    addons: cloneJson(item.addons, []),
  }));

export const toPrismaInventoryPayload = (payload = {}) => ({
  name: payload.name || "Unnamed Item",
  stock: toNumber(payload.stock, 0),
  unit: payload.unit || DEFAULT_INVENTORY_UNIT,
  reorderLevel: toNumber(payload.reorderLevel, 0),
  vendor: payload.vendor || null,
  storageLocation: payload.storage_location || payload.storageLocation || null,
  notes: payload.notes || null,
  expiryDate: toDate(payload.expiry_date || payload.expiryDate),
  conversionCost: toNumber(payload.conversion_cost ?? payload.conversionCost, 0),
});

