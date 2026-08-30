import authRoutes from "../core/auth/auth.routes.js";
import businessesRoutes from "../core/businesses/businesses.routes.js";
import saasRoutes from "../core/saas/saas.routes.js";
import dashboardRoutes from "../core/dashboard/dashboard.routes.js";
import reportsRoutes from "../core/reports/reports.routes.js";
import feedbackRoutes from "../core/feedback/feedback.routes.js";
import featuresRoutes from "../core/features/features.routes.js";
import usersRoutes from "../core/users/users.routes.js";
import customersRoutes from "../core/customers/customers.routes.js";
import productsRoutes from "../core/products/products.routes.js";
import ordersRoutes from "../core/orders/orders.routes.js";
import billingRoutes from "../core/billing/billing.routes.js";
import inventoryRoutes from "../core/inventory/inventory.routes.js";
import outletsRoutes from "../core/outlets/outlets.routes.js";
import tablesRoutes from "../core/tables/tables.routes.js";
import reservationsRoutes from "../core/reservations/reservations.routes.js";
import admincoreRoutes from "../core/admincore/admincore.routes.js";
import paymentsRoutes from "../core/payments/payments.routes.js";
import printerRoutes from "../core/printer/printer.routes.js";
import syncRoutes from "../core/sync/sync.routes.js";
import kotRoutes from "../features/kitchen/kot/kot.routes.js";
import barcodeRoutes from "../features/barcode/barcode.routes.js";
import tableManagementRoutes from "../features/sales-extensions/table-management/table-management.routes.js";
import qrOrderingRoutes from "../features/sales-extensions/qr-ordering/qr-ordering.routes.js";
import batchTrackingRoutes from "../features/inventory-advanced/batch-tracking/batch-tracking.routes.js";
import outletInventoryAllocationRoutes from "../features/logistics/outlet-inventory-allocation/outlet-inventory-allocation.routes.js";
import outletPurchaseOrdersRoutes from "../features/logistics/outlet-purchase-orders/outlet-purchase-orders.routes.js";
import deliveryRoutePlanRoutes from "../features/logistics/delivery-route-plan/delivery-route-plan.routes.js";
import { API_ROUTE_SEGMENTS, FEATURE_KEYS } from "../shared/constants/module.constants.js";

export const coreRouteModules = [
  { type: "core", key: API_ROUTE_SEGMENTS.AUTH, path: `/${API_ROUTE_SEGMENTS.AUTH}`, router: authRoutes },
  { type: "core", key: API_ROUTE_SEGMENTS.BUSINESSES, path: `/${API_ROUTE_SEGMENTS.BUSINESSES}`, router: businessesRoutes },
  { type: "core", key: API_ROUTE_SEGMENTS.SAAS, path: `/${API_ROUTE_SEGMENTS.SAAS}`, router: saasRoutes },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.FEATURES,
    path: `/${API_ROUTE_SEGMENTS.FEATURES}`,
    router: featuresRoutes,
  },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.DASHBOARD,
    path: `/${API_ROUTE_SEGMENTS.DASHBOARD}`,
    router: dashboardRoutes,
  },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.REPORTS,
    path: `/${API_ROUTE_SEGMENTS.REPORTS}`,
    router: reportsRoutes,
  },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.FEEDBACK,
    path: `/${API_ROUTE_SEGMENTS.FEEDBACK}`,
    router: feedbackRoutes,
  },
  { type: "core", key: API_ROUTE_SEGMENTS.USERS, path: `/${API_ROUTE_SEGMENTS.USERS}`, router: usersRoutes },
  { type: "core", key: API_ROUTE_SEGMENTS.CUSTOMERS, path: `/${API_ROUTE_SEGMENTS.CUSTOMERS}`, router: customersRoutes },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.PRODUCTS,
    path: `/${API_ROUTE_SEGMENTS.PRODUCTS}`,
    router: productsRoutes,
  },
  { type: "core", key: API_ROUTE_SEGMENTS.ORDERS, path: `/${API_ROUTE_SEGMENTS.ORDERS}`, router: ordersRoutes },
  { type: "core", key: API_ROUTE_SEGMENTS.BILLING, path: `/${API_ROUTE_SEGMENTS.BILLING}`, router: billingRoutes },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.INVENTORY,
    path: `/${API_ROUTE_SEGMENTS.INVENTORY}`,
    router: inventoryRoutes,
  },
  { type: "core", key: API_ROUTE_SEGMENTS.OUTLETS, path: `/${API_ROUTE_SEGMENTS.OUTLETS}`, router: outletsRoutes },
  { type: "core", key: API_ROUTE_SEGMENTS.TABLES, path: `/${API_ROUTE_SEGMENTS.TABLES}`, router: tablesRoutes },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.RESERVATIONS,
    path: `/${API_ROUTE_SEGMENTS.RESERVATIONS}`,
    router: reservationsRoutes,
  },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.ADMINCORE,
    path: `/${API_ROUTE_SEGMENTS.ADMINCORE}`,
    router: admincoreRoutes,
  },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.PAYMENTS,
    path: `/${API_ROUTE_SEGMENTS.PAYMENTS}`,
    router: paymentsRoutes,
  },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.PRINTER,
    path: `/${API_ROUTE_SEGMENTS.PRINTER}`,
    router: printerRoutes,
  },
  {
    type: "core",
    key: API_ROUTE_SEGMENTS.SYNC,
    path: `/${API_ROUTE_SEGMENTS.SYNC}`,
    router: syncRoutes,
  },
  { type: "core", key: "public-qr-ordering", path: "/public/qr", router: qrOrderingRoutes },
];

export const featureRouteModules = [
  { type: "feature", key: FEATURE_KEYS.KOT, path: `/${API_ROUTE_SEGMENTS.KOT}`, router: kotRoutes },
  { type: "feature", key: FEATURE_KEYS.BARCODE, path: `/${API_ROUTE_SEGMENTS.BARCODE}`, router: barcodeRoutes },
  {
    type: "feature",
    key: FEATURE_KEYS.TABLE_MANAGEMENT,
    path: `/${API_ROUTE_SEGMENTS.TABLE_MANAGEMENT}`,
    router: tableManagementRoutes,
  },
  {
    type: "feature",
    key: FEATURE_KEYS.BATCH_TRACKING,
    path: `/${API_ROUTE_SEGMENTS.BATCH_TRACKING}`,
    router: batchTrackingRoutes,
  },
  {
    type: "feature",
    key: FEATURE_KEYS.OUTLET_INVENTORY_ALLOCATION,
    path: `/${API_ROUTE_SEGMENTS.OUTLET_INVENTORY_ALLOCATION}`,
    router: outletInventoryAllocationRoutes,
  },
  {
    type: "feature",
    key: FEATURE_KEYS.OUTLET_PURCHASE_ORDERS,
    path: `/${API_ROUTE_SEGMENTS.OUTLET_PURCHASE_ORDERS}`,
    router: outletPurchaseOrdersRoutes,
  },
  {
    type: "feature",
    key: FEATURE_KEYS.DELIVERY_ROUTE_PLAN,
    path: `/${API_ROUTE_SEGMENTS.DELIVERY_ROUTE_PLAN}`,
    router: deliveryRoutePlanRoutes,
  },
];

export const routeModules = [...coreRouteModules, ...featureRouteModules];
