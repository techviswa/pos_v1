import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { businessesService } from "../businesses/businesses.service.js";
import { outletsService } from "../outlets/outlets.service.js";
import { productsService } from "../products/products.service.js";
import { ordersService } from "../orders/orders.service.js";
import { usersService } from "../users/users.service.js";
import { inventoryService } from "../inventory/inventory.service.js";
import { billingService } from "../billing/billing.service.js";
import { paymentsService } from "../payments/payments.service.js";
import { reportsService } from "../reports/reports.service.js";
import { kotService } from "../../features/kitchen/kot/kot.service.js";
import { tableManagementService } from "../../features/sales-extensions/table-management/table-management.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { normalizeBillingMetadata } from "../billing/billing-metadata.utils.js";
import prisma from "../../database/prisma/client.js";
import {
  listAdminCoreSyncLogs,
  normalizeAdminCoreSyncResource,
  recordAdminCoreSyncLog,
} from "./admincore-sync-log.repository.js";
import { createSyncEnvelope } from "./sync-contract.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../../../data");
const eventsPath = path.join(dataDirectory, "offline-sync-events.json");

const nowIso = () => new Date().toISOString();
const ADMINCORE_SYNC_RESOURCES = [
  "businesses",
  "outlets",
  "products",
  "orders",
  "bills",
  "customers",
  "payments",
  "reports",
  "staff",
  "inventory",
  "tables",
  "qr",
  "reservations",
  "kot",
  "central-kitchen",
  "taxes",
  "discounts",
  "suppliers",
  "expenses",
  "hardware",
  "permissions",
  "notifications",
  "import-export",
  "webhooks",
  "audit-security",
  "settings",
];

const readEvents = async () => {
  try {
    const raw = await readFile(eventsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeEvents = async (events) => {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(eventsPath, JSON.stringify(events, null, 2), "utf8");
};

const normalizeResource = (resource) => {
  return normalizeAdminCoreSyncResource(resource);
};

const normalizeExportData = (resource, data) => {
  if (resource === "tables") {
    return data.items || [];
  }
  if (resource === "reservations") {
    return data.items || [];
  }
  if (resource === "kot") {
    return data.items || [];
  }
  return Array.isArray(data) ? data : data?.items || [];
};

const toIso = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toISOString === "function") return value.toISOString();
  return String(value);
};

const cloneJson = (value, fallback = null) => {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
};

const getBusinessContext = async ({ tenantId, businessId }) => {
  const business = await prisma.business.findFirst({
    where: {
      ...(businessId ? { id: businessId } : {}),
      ...(tenantId ? { tenantId } : {}),
    },
  });
  if (!business) {
    throw createHttpError({
      statusCode: 404,
      code: "BUSINESS_NOT_FOUND",
      message: "Business not found for AdminCore sync export",
    });
  }
  return business;
};

const syncRecordBase = ({ id, business, resource, type = resource, status = "active", title = null, createdAt = null, updatedAt = null }) => ({
  id,
  tenantId: business.tenantId,
  tenant_id: business.tenantId,
  business_id: business.id,
  resource_type: type,
  title,
  status,
  sync_source: "pos-core",
  sync_resource: resource,
  last_synced_at: toIso(updatedAt || createdAt) || nowIso(),
  created_at: toIso(createdAt),
  updated_at: toIso(updatedAt),
});

const parseItemsAmount = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const quantity = Number(item.quantity ?? item.qty ?? 1);
    const price = Number(item.price ?? item.cost ?? item.unit_cost ?? item.unitCost ?? item.amount ?? 0);
    return sum + quantity * price;
  }, 0);
};

const getSyncLimit = (value, fallback = 250, max = 1000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
};

const getCustomerKey = ({ name, phone }) => {
  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  return `name:${String(name || "Walk-in Customer").trim().toLowerCase()}`;
};

const serializeCustomerRows = ({ bills = [], orders = [], tenantId, businessId }) => {
  const rowsByKey = new Map();
  const upsert = (row) => {
    const name = String(row.customer_name || row.customerName || "Walk-in Customer").trim() || "Walk-in Customer";
    const phone = row.customer_phone || row.metadata?.customer_phone || null;
    const key = getCustomerKey({ name, phone });
    const current = rowsByKey.get(key) || {
      id: key.replace(/[^a-zA-Z0-9_-]/g, "_"),
      customer_id: key.replace(/[^a-zA-Z0-9_-]/g, "_"),
      tenantId,
      tenant_id: tenantId,
      business_id: businessId,
      name,
      phone,
      email: null,
      order_count: 0,
      bill_count: 0,
      total_spent: 0,
      first_seen_at: row.created_at || row.createdAt?.toISOString?.() || nowIso(),
      last_seen_at: row.updated_at || row.updatedAt?.toISOString?.() || row.created_at || nowIso(),
      sync_source: "pos-core",
      sync_resource: "customers",
      last_synced_at: nowIso(),
    };

    current.order_count += row.order_id || row.channel ? 1 : 0;
    current.bill_count += row.invoice_number || row.bill_id || row.currency ? 1 : 0;
    current.total_spent += Number(row.total || 0);
    current.last_seen_at = [current.last_seen_at, row.updated_at || row.created_at].filter(Boolean).sort().at(-1);
    rowsByKey.set(key, current);
  };

  bills.forEach(upsert);
  orders.forEach(upsert);
  return [...rowsByKey.values()];
};

const serializePaymentRows = ({ bills = [], intents = [], tenantId, businessId }) => {
  const billPayments = bills.flatMap((bill) => {
    const metadata = normalizeBillingMetadata(bill.metadata || bill);
    return (metadata.payments || []).map((payment, index) => ({
      id: payment.id || `${bill.id}_payment_${index + 1}`,
      payment_id: payment.id || `${bill.id}_payment_${index + 1}`,
      tenantId,
      tenant_id: tenantId,
      business_id: businessId,
      outlet_id: metadata.outlet_id || bill.outlet_id || null,
      bill_id: bill.id,
      order_id: bill.order_id || null,
      invoice_number: metadata.invoice_number || bill.invoice_number || bill.id,
      method: payment.method,
      amount: Number(payment.amount || 0),
      status: payment.status || "confirmed",
      reference: payment.reference || null,
      gateway: payment.gateway || null,
      customer_name: bill.customerName || bill.customer_name || null,
      customer_phone: metadata.customer_phone || null,
      received_at: payment.received_at || bill.created_at || null,
      confirmed_at: payment.status === "confirmed" ? payment.received_at || bill.created_at || null : null,
      sync_source: "pos-core",
      sync_resource: "payments",
      last_synced_at: bill.updated_at || bill.created_at || nowIso(),
    }));
  });

  const intentPayments = intents.map((intent) => ({
    ...intent,
    tenantId,
    tenant_id: tenantId,
    business_id: businessId,
    payment_id: intent.id,
    bill_id: intent.invoice_id || null,
    amount: Number(intent.amount || 0),
    sync_source: "pos-core",
    sync_resource: "payments",
    last_synced_at: intent.updated_at || nowIso(),
  }));

  return [...billPayments, ...intentPayments];
};

const serializeTaxRows = ({ bills = [], business }) =>
  bills
    .filter((bill) => Number(bill.tax || 0) > 0 || normalizeBillingMetadata(bill.metadata || bill).taxes)
    .map((bill) => {
      const metadata = normalizeBillingMetadata(bill.metadata || bill);
      return {
        ...syncRecordBase({
          id: `tax_${bill.id}`,
          business,
          resource: "taxes",
          type: "bill_tax",
          status: bill.status || "active",
          title: `Tax for ${metadata.invoice_number || bill.id}`,
          createdAt: bill.created_at || bill.createdAt,
          updatedAt: bill.updated_at || bill.updatedAt,
        }),
        bill_id: bill.id,
        invoice_number: metadata.invoice_number || bill.invoice_number || bill.id,
        outlet_id: metadata.outlet_id || bill.outlet_id || null,
        customer_name: bill.customerName || bill.customer_name || null,
        taxable_amount: Number(bill.subtotal || 0),
        tax_amount: Number(bill.tax || 0),
        total_amount: Number(bill.total || 0),
        tax_breakup: metadata.gst_breakup || metadata.tax_breakup || metadata.taxes || null,
        metadata,
      };
    });

const serializeDiscountRows = ({ bills = [], orders = [], business }) => {
  const rows = [];
  const append = (row, source) => {
    const metadata = normalizeBillingMetadata(row.metadata || row);
    const amount = Number(
      metadata.discount_amount ??
        metadata.discountAmount ??
        metadata.discount ??
        row.discount_amount ??
        row.discount ??
        0,
    );
    const label = metadata.discount_label || metadata.discountLabel || metadata.coupon_code || metadata.couponCode || "POS Discount";
    if (!amount && !metadata.coupon_code && !metadata.couponCode) return;
    rows.push({
      ...syncRecordBase({
        id: `discount_${source}_${row.id}`,
        business,
        resource: "discounts",
        type: source,
        status: row.status || "active",
        title: label,
        createdAt: row.created_at || row.createdAt,
        updatedAt: row.updated_at || row.updatedAt,
      }),
      source_id: row.id,
      outlet_id: metadata.outlet_id || row.outlet_id || null,
      discount_amount: amount,
      discount_label: label,
      coupon_code: metadata.coupon_code || metadata.couponCode || null,
      order_total: Number(row.total || 0),
      metadata,
    });
  };
  bills.forEach((bill) => append(bill, "bill"));
  orders.forEach((order) => append(order, "order"));
  return rows;
};

const listQrExportRows = async (business, limit = 250) => {
  const [qrCodes, sessions, scans] = await Promise.all([
    prisma.tableQrCode.findMany({
      where: { businessId: business.id },
      include: { table: { include: { area: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.tableSession.findMany({
      where: { businessId: business.id },
      include: { table: true, qrCode: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.tableQrScanEvent.findMany({
      where: { businessId: business.id },
      include: { qrCode: true },
      orderBy: { scannedAt: "desc" },
      take: limit,
    }),
  ]);

  return [
    ...qrCodes.map((qr) => ({
      ...syncRecordBase({
        id: qr.id,
        business,
        resource: "qr",
        type: "table_qr_code",
        status: qr.active ? "active" : "inactive",
        title: qr.table?.name || "Table QR",
        createdAt: qr.createdAt,
        updatedAt: qr.updatedAt,
      }),
      qr_code_id: qr.id,
      token: qr.token,
      table_id: qr.tableId,
      table_name: qr.table?.name || null,
      area_id: qr.table?.areaId || null,
      area_name: qr.table?.area?.name || null,
      active: qr.active,
      scan_count: qr.scanCount || 0,
      last_scanned_at: toIso(qr.lastScannedAt),
      rotated_at: toIso(qr.rotatedAt),
    })),
    ...sessions.map((session) => ({
      ...syncRecordBase({
        id: session.id,
        business,
        resource: "qr",
        type: "table_session",
        status: session.status,
        title: session.customerName || session.table?.name || "QR Table Session",
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }),
      session_id: session.id,
      session_key: session.sessionKey,
      table_id: session.tableId,
      table_name: session.table?.name || null,
      qr_code_id: session.qrCodeId || null,
      source: session.source,
      customer_name: session.customerName || null,
      customer_phone: session.customerPhone || null,
      guest_count: session.guestCount || null,
      opened_at: toIso(session.openedAt),
      closed_at: toIso(session.closedAt),
      metadata: cloneJson(session.metadata, {}),
    })),
    ...scans.map((scan) => ({
      ...syncRecordBase({
        id: scan.id,
        business,
        resource: "qr",
        type: "qr_scan_event",
        status: "completed",
        title: "QR Scan",
        createdAt: scan.scannedAt,
        updatedAt: scan.scannedAt,
      }),
      scan_id: scan.id,
      qr_code_id: scan.qrCodeId,
      table_id: scan.tableId,
      scanned_at: toIso(scan.scannedAt),
      referrer: scan.referrer || null,
      user_agent: scan.userAgent || null,
    })),
  ];
};

const listCentralKitchenRows = async (business, limit = 250) => {
  const [purchaseOrders, allocations, routePlans, movements] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { businessId: business.id },
      include: { outlet: true, requestedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.allocation.findMany({
      where: { businessId: business.id },
      include: { outlet: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.routePlan.findMany({
      where: { businessId: business.id },
      include: { stops: { include: { outlet: true }, orderBy: { sequence: "asc" } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.inventoryMovement.findMany({
      where: { businessId: business.id },
      include: { inventoryItem: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  return [
    ...purchaseOrders.map((po) => ({
      ...syncRecordBase({
        id: po.id,
        business,
        resource: "central-kitchen",
        type: "purchase_order",
        status: po.status,
        title: po.outlet?.name ? `Purchase order for ${po.outlet.name}` : "Purchase order",
        createdAt: po.createdAt,
        updatedAt: po.updatedAt,
      }),
      outlet_id: po.outletId,
      outlet_name: po.outlet?.name || null,
      requested_by_id: po.requestedById,
      requested_by_name: po.requestedBy?.name || null,
      priority: po.priority || null,
      required_by: toIso(po.requiredBy),
      notes: po.notes || "",
      items: cloneJson(po.items, []),
      amount: parseItemsAmount(po.items),
    })),
    ...allocations.map((allocation) => ({
      ...syncRecordBase({
        id: allocation.id,
        business,
        resource: "central-kitchen",
        type: "allocation",
        status: allocation.status,
        title: allocation.outlet?.name ? `Allocation to ${allocation.outlet.name}` : "Stock allocation",
        createdAt: allocation.createdAt,
        updatedAt: allocation.updatedAt,
      }),
      outlet_id: allocation.outletId,
      outlet_name: allocation.outlet?.name || null,
      purchase_order_id: allocation.purchaseOrderId || null,
      route_plan_id: allocation.routePlanId || null,
      source_location: allocation.sourceLocation,
      items: cloneJson(allocation.items, []),
      amount: parseItemsAmount(allocation.items),
    })),
    ...routePlans.map((route) => ({
      ...syncRecordBase({
        id: route.id,
        business,
        resource: "central-kitchen",
        type: "route_plan",
        status: route.status,
        title: route.routeName,
        createdAt: route.createdAt,
        updatedAt: route.updatedAt,
      }),
      route_name: route.routeName,
      dispatch_date: toIso(route.dispatchDate),
      driver_name: route.driverName || null,
      vehicle_number: route.vehicleNumber || null,
      stops: route.stops.map((stop) => ({
        id: stop.id,
        outlet_id: stop.outletId,
        outlet_name: stop.outlet?.name || null,
        sequence: stop.sequence,
        eta: stop.eta || null,
      })),
    })),
    ...movements.map((movement) => ({
      ...syncRecordBase({
        id: movement.id,
        business,
        resource: "central-kitchen",
        type: "inventory_movement",
        status: movement.movementType,
        title: movement.inventoryItem?.name || "Inventory movement",
        createdAt: movement.createdAt,
        updatedAt: movement.createdAt,
      }),
      inventory_item_id: movement.inventoryItemId,
      inventory_item_name: movement.inventoryItem?.name || null,
      movement_type: movement.movementType,
      quantity: Number(movement.quantity || 0),
      unit: movement.inventoryItem?.unit || null,
      reason: movement.reason || null,
      expiry_date: toIso(movement.expiryDate),
    })),
  ];
};

const listSupplierRows = async (business, limit = 250) => {
  const [items, purchaseOrders] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { businessId: business.id }, orderBy: { updatedAt: "desc" }, take: limit }),
    prisma.purchaseOrder.findMany({ where: { businessId: business.id }, include: { outlet: true }, orderBy: { updatedAt: "desc" }, take: limit }),
  ]);
  const suppliers = new Map();
  for (const item of items) {
    const vendor = String(item.vendor || "").trim();
    if (!vendor) continue;
    const id = `supplier_${vendor.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    const current = suppliers.get(id) || {
      ...syncRecordBase({
        id,
        business,
        resource: "suppliers",
        type: "supplier",
        status: "active",
        title: vendor,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }),
      supplier_name: vendor,
      item_count: 0,
      inventory_items: [],
      purchase_orders: [],
      amount: 0,
    };
    current.item_count += 1;
    current.inventory_items.push({ id: item.id, name: item.name, stock: item.stock, unit: item.unit });
    suppliers.set(id, current);
  }
  for (const po of purchaseOrders) {
    const vendors = Array.isArray(po.items)
      ? [...new Set(po.items.map((item) => String(item.vendor || item.supplier || "").trim()).filter(Boolean))]
      : [];
    for (const vendor of vendors) {
      const id = `supplier_${vendor.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      const current =
        suppliers.get(id) ||
        {
          ...syncRecordBase({
            id,
            business,
            resource: "suppliers",
            type: "supplier",
            status: "active",
            title: vendor,
            createdAt: po.createdAt,
            updatedAt: po.updatedAt,
          }),
          supplier_name: vendor,
          item_count: 0,
          inventory_items: [],
          purchase_orders: [],
          amount: 0,
        };
      current.purchase_orders.push({ id: po.id, outlet_id: po.outletId, outlet_name: po.outlet?.name || null, status: po.status });
      current.amount += parseItemsAmount(po.items);
      suppliers.set(id, current);
    }
  }
  return [...suppliers.values()];
};

const listPermissionRows = async (business, limit = 250) => {
  const [roles, permissions, users] = await Promise.all([
    prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } }),
    prisma.permission.findMany({ orderBy: { key: "asc" } }),
    prisma.user.findMany({
      where: { businessId: business.id },
      include: {
        role: true,
        permissions: { include: { permission: true } },
        outletAssignments: { include: { outlet: true } },
      },
      orderBy: { name: "asc" },
      take: limit,
    }),
  ]);
  return [
    ...roles.map((role) => ({
      ...syncRecordBase({
        id: `role_${role.id}`,
        business,
        resource: "permissions",
        type: "role",
        status: "active",
        title: role.name,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      }),
      role_id: role.id,
      role_name: role.name,
      permissions: role.permissions.map((item) => item.permission?.key).filter(Boolean),
    })),
    ...permissions.map((permission) => ({
      ...syncRecordBase({
        id: `permission_${permission.id}`,
        business,
        resource: "permissions",
        type: "permission",
        status: "active",
        title: permission.label,
        createdAt: permission.createdAt,
        updatedAt: permission.updatedAt,
      }),
      permission_id: permission.id,
      permission_key: permission.key,
      permission_label: permission.label,
    })),
    ...users.map((user) => ({
      ...syncRecordBase({
        id: `user_permission_${user.id}`,
        business,
        resource: "permissions",
        type: "user_access",
        status: user.active ? "active" : "disabled",
        title: user.name,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }),
      user_id: user.id,
      name: user.name,
      email: user.email,
      role: user.role?.name || null,
      profile_required: user.profileRequired,
      outlet_ids: user.outletAssignments.map((assignment) => assignment.outletId),
      outlet_names: user.outletAssignments.map((assignment) => assignment.outlet?.name).filter(Boolean),
      direct_permissions: user.permissions.map((item) => item.permission?.key).filter(Boolean),
    })),
  ];
};

const listAuditSecurityRows = async (business, limit = 250) => {
  const [activities, tokens] = await Promise.all([
    prisma.staffActivity.findMany({
      where: { user: { is: { businessId: business.id } } },
      include: { user: { select: { id: true, name: true, email: true, role: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.authToken.findMany({
      where: { user: { is: { businessId: business.id } } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  return [
    ...activities.map((activity) => ({
      ...syncRecordBase({
        id: activity.id,
        business,
        resource: "audit-security",
        type: "staff_activity",
        status: "review",
        title: activity.action,
        createdAt: activity.createdAt,
        updatedAt: activity.createdAt,
      }),
      user_id: activity.userId,
      actor_name: activity.actorName || activity.user?.name || null,
      user_email: activity.user?.email || null,
      role: activity.user?.role?.name || null,
      action: activity.action,
    })),
    ...tokens.map((token) => ({
      ...syncRecordBase({
        id: token.id,
        business,
        resource: "audit-security",
        type: "auth_token",
        status: token.usedAt ? "resolved" : token.expiresAt < new Date() ? "ignored" : "open",
        title: token.type,
        createdAt: token.createdAt,
        updatedAt: token.usedAt || token.createdAt,
      }),
      token_id: token.id,
      token_type: token.type,
      user_id: token.userId || null,
      user_email: token.user?.email || null,
      expires_at: toIso(token.expiresAt),
      used_at: toIso(token.usedAt),
      metadata: cloneJson(token.metadata, {}),
    })),
  ];
};

const listSettingsRows = async (business) => {
  const [tableSettings, featureToggles, outletToggles] = await Promise.all([
    prisma.tableManagementSettings.findUnique({ where: { businessId: business.id } }),
    prisma.featureToggle.findMany({ where: { businessId: business.id } }),
    prisma.outletFeatureToggle.findMany({
      where: { outlet: { is: { businessId: business.id } } },
      include: { outlet: true },
    }),
  ]);
  return [
    ...(tableSettings
      ? [
          {
            ...syncRecordBase({
              id: tableSettings.id,
              business,
              resource: "settings",
              type: "table_management_settings",
              status: "active",
              title: "Table management settings",
              createdAt: tableSettings.createdAt,
              updatedAt: tableSettings.updatedAt,
            }),
            niche_preset: tableSettings.nichePreset,
            service_mode: tableSettings.serviceMode,
            capabilities: cloneJson(tableSettings.capabilities, {}),
            reservation_rules: cloneJson(tableSettings.reservationRules, {}),
            ui_preferences: cloneJson(tableSettings.uiPreferences, {}),
          },
        ]
      : []),
    ...featureToggles.map((toggle) => ({
      ...syncRecordBase({
        id: toggle.id,
        business,
        resource: "settings",
        type: "business_feature_toggle",
        status: toggle.enabled ? "active" : "inactive",
        title: toggle.featureKey,
        createdAt: null,
        updatedAt: null,
      }),
      feature_key: toggle.featureKey,
      enabled: toggle.enabled,
    })),
    ...outletToggles.map((toggle) => ({
      ...syncRecordBase({
        id: toggle.id,
        business,
        resource: "settings",
        type: "outlet_feature_toggle",
        status: toggle.enabled ? "active" : "inactive",
        title: `${toggle.outlet?.name || "Outlet"} ${toggle.featureKey}`,
        createdAt: toggle.createdAt,
        updatedAt: toggle.updatedAt,
      }),
      outlet_id: toggle.outletId,
      outlet_name: toggle.outlet?.name || null,
      feature_key: toggle.featureKey,
      enabled: toggle.enabled,
    })),
  ];
};

const listOperationalConfigRows = ({ business, resource, label, status, metadata = {} }) => [
  {
    ...syncRecordBase({
      id: `${resource}_${business.id}`,
      business,
      resource,
      type: "operational_config",
      status,
      title: label,
      createdAt: business.createdAt,
      updatedAt: business.updatedAt,
    }),
    metadata,
  },
];

class SyncService {
  getStrategy() {
    return {
      mode: "online-first-with-client-event-buffer",
      server_conflict_policy: "latest-server-version-wins-until-record-level-versioning-is-added",
      supported_resources: ADMINCORE_SYNC_RESOURCES,
      client_requirements: [
        "Keep writes in a local queue when offline",
        "Replay queued writes to /api/sync/client-events after reconnect",
        "Use idempotency_key for every replayed write",
      ],
      production_notes: [
        "Move sync events to a durable table during the Postgres phase",
        "Add record version columns before enabling multi-device conflict resolution",
      ],
    };
  }

  async listClientEvents({ tenantId, status } = {}) {
    const events = await readEvents();
    return events
      .filter((event) => !tenantId || event.tenant_id === tenantId)
      .filter((event) => !status || event.status === status)
      .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  }

  async recordClientEvent({ tenantId, businessId, user, payload }) {
    const events = await readEvents();
    const event = {
      id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: tenantId,
      business_id: businessId,
      user_id: user?.id || null,
      resource: payload.resource || "unknown",
      action: payload.action || "upsert",
      idempotency_key: payload.idempotency_key || null,
      payload: payload.payload || {},
      status: "received",
      received_at: nowIso(),
    };

    const duplicate = event.idempotency_key
      ? events.find((item) => item.tenant_id === tenantId && item.idempotency_key === event.idempotency_key)
      : null;

    if (duplicate) {
      return { ...duplicate, duplicate: true };
    }

    events.push(event);
    await writeEvents(events.slice(-1000));
    return event;
  }

  async listAdminCoreLogs({ tenantId, resource, status } = {}) {
    return listAdminCoreSyncLogs({ tenantId, resource, status });
  }

  async recordAdminCoreLog(payload = {}) {
    return recordAdminCoreSyncLog(payload);
  }

  async exportResource({ resource, tenantId, businessId, query = {} }) {
    const normalizedResource = normalizeResource(resource);
    const limit = getSyncLimit(query.limit);
    let data;

    if (normalizedResource === "businesses") {
      data = await businessesService.listBusinesses({ businessId });
    } else if (normalizedResource === "outlets") {
      data = await outletsService.listOutlets({ tenantId, businessId });
    } else if (normalizedResource === "products") {
      data = await productsService.listProducts({ tenantId, query });
    } else if (normalizedResource === "orders") {
      data = await ordersService.listOrders({ tenantId, query });
    } else if (normalizedResource === "bills") {
      data = await billingService.listInvoices({
        tenantId,
        limit,
        page: query.page,
        offset: query.offset,
      });
    } else if (normalizedResource === "customers") {
      const [bills, orders] = await Promise.all([
        billingService.listInvoices({
          tenantId,
          limit,
          page: query.page,
          offset: query.offset,
        }),
        ordersService.listOrders({
          tenantId,
          query: {
            limit,
            page: query.page,
            offset: query.offset,
          },
        }),
      ]);
      data = serializeCustomerRows({ bills, orders, tenantId, businessId });
    } else if (normalizedResource === "payments") {
      const bills = await billingService.listInvoices({
        tenantId,
        limit,
        page: query.page,
        offset: query.offset,
      });
      data = serializePaymentRows({
        bills,
        intents: paymentsService.listIntents({ status: query.status }),
        tenantId,
        businessId,
      });
    } else if (normalizedResource === "reports") {
      data = [
        {
          id: `reports_${businessId || tenantId || "all"}`,
          tenantId,
          tenant_id: tenantId,
          business_id: businessId,
          generated_at: nowIso(),
          reports: await reportsService.getDashboard({
            tenantId,
            from: query.from,
            to: query.to,
            outletId: query.outlet_id || query.outletId || null,
          }),
          sync_source: "pos-core",
          sync_resource: "reports",
          last_synced_at: nowIso(),
        },
      ];
    } else if (normalizedResource === "staff") {
      data = await usersService.listUsers({ tenantId, businessId });
    } else if (normalizedResource === "inventory") {
      data = await inventoryService.listItems({ tenantId, query });
    } else if (normalizedResource === "tables") {
      data = await tableManagementService.listTables({ tenantId, businessId });
    } else if (normalizedResource === "qr") {
      data = await listQrExportRows(await getBusinessContext({ tenantId, businessId }), limit);
    } else if (normalizedResource === "reservations") {
      data = await tableManagementService.listReservations({ tenantId, businessId, includeHistory: true });
    } else if (normalizedResource === "kot") {
      data = await kotService.listTickets({
        tenantId,
        limit,
        status: query.status,
        stationId: query.station_id || query.stationId,
      });
    } else if (normalizedResource === "central-kitchen") {
      data = await listCentralKitchenRows(await getBusinessContext({ tenantId, businessId }), limit);
    } else if (normalizedResource === "taxes") {
      const business = await getBusinessContext({ tenantId, businessId });
      const bills = await billingService.listInvoices({
        tenantId: business.tenantId,
        limit,
        page: query.page,
        offset: query.offset,
      });
      data = serializeTaxRows({ bills, business });
    } else if (normalizedResource === "discounts") {
      const business = await getBusinessContext({ tenantId, businessId });
      const [bills, orders] = await Promise.all([
        billingService.listInvoices({
          tenantId: business.tenantId,
          limit,
          page: query.page,
          offset: query.offset,
        }),
        ordersService.listOrders({
          tenantId: business.tenantId,
          query: { limit, page: query.page, offset: query.offset },
        }),
      ]);
      data = serializeDiscountRows({ bills, orders, business });
    } else if (normalizedResource === "suppliers") {
      data = await listSupplierRows(await getBusinessContext({ tenantId, businessId }), limit);
    } else if (normalizedResource === "expenses") {
      const business = await getBusinessContext({ tenantId, businessId });
      const centralKitchenRows = await listCentralKitchenRows(business, limit);
      data = centralKitchenRows
        .filter((row) => ["purchase_order", "allocation"].includes(row.resource_type))
        .map((row) => ({
          ...row,
          id: `expense_${row.id}`,
          sync_resource: "expenses",
          resource_type: "procurement_expense",
          title: row.title || "Procurement expense",
          status: row.status === "received" ? "paid" : row.status === "cancelled" ? "rejected" : "pending",
        }));
    } else if (normalizedResource === "hardware") {
      const business = await getBusinessContext({ tenantId, businessId });
      data = listOperationalConfigRows({
        business,
        resource: "hardware",
        label: "POS hardware and printer configuration",
        status: "disabled",
        metadata: { printer_jobs_are_runtime_only: true, persisted_hardware_devices: false },
      });
    } else if (normalizedResource === "permissions") {
      data = await listPermissionRows(await getBusinessContext({ tenantId, businessId }), limit);
    } else if (normalizedResource === "notifications") {
      const business = await getBusinessContext({ tenantId, businessId });
      data = listOperationalConfigRows({
        business,
        resource: "notifications",
        label: "POS notification configuration",
        status: "enabled",
        metadata: { admincore_webhook_enabled: true, resource_notifications: ADMINCORE_SYNC_RESOURCES },
      });
    } else if (normalizedResource === "import-export") {
      const business = await getBusinessContext({ tenantId, businessId });
      data = ADMINCORE_SYNC_RESOURCES.map((syncResource) => ({
        ...syncRecordBase({
          id: `import_export_${business.id}_${syncResource}`,
          business,
          resource: "import-export",
          type: "sync_resource",
          status: "completed",
          title: syncResource,
          createdAt: business.createdAt,
          updatedAt: business.updatedAt,
        }),
        export_endpoint: `/api/sync/export/${syncResource}`,
        import_supported: ["businesses", "outlets", "products", "staff"].includes(syncResource),
        export_supported: true,
      }));
    } else if (normalizedResource === "webhooks") {
      const business = await getBusinessContext({ tenantId, businessId });
      data = listOperationalConfigRows({
        business,
        resource: "webhooks",
        label: "AdminCore POS bridge webhook",
        status: "connected",
        metadata: { sync_status_webhook: "ADMINCORE_SYNC_WEBHOOK_URL", secret_exposed: false },
      });
    } else if (normalizedResource === "audit-security") {
      data = await listAuditSecurityRows(await getBusinessContext({ tenantId, businessId }), limit);
    } else if (normalizedResource === "settings") {
      data = await listSettingsRows(await getBusinessContext({ tenantId, businessId }));
    } else {
      throw createHttpError({
        statusCode: 400,
        code: "UNSUPPORTED_SYNC_RESOURCE",
        message: `Unsupported AdminCore sync resource: ${resource}`,
        details: {
          supported_resources: ADMINCORE_SYNC_RESOURCES,
        },
      });
    }

    const items = normalizeExportData(normalizedResource, data);
    const syncedAt = new Date().toISOString();
    const log = await this.recordAdminCoreLog({
      tenant_id: tenantId,
      business_id: businessId,
      outlet_id: query.outlet_id || query.outletId || null,
      resource: normalizedResource,
      status: "success",
      synced_count: items.length,
      error_count: 0,
      synced_at: syncedAt,
      message: `Exported ${items.length} ${normalizedResource} records for AdminCore`,
    });

    return {
      ...createSyncEnvelope({
        resource: normalizedResource,
        data: items,
        tenantId,
        businessId,
        outletId: query.outlet_id || query.outletId || null,
        lastSyncedAt: syncedAt,
      }),
      sync_log_id: log.id,
    };
  }
}

export const syncService = new SyncService();
