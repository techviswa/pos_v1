import { FEATURE_KEYS } from "./module.constants.js";

export const FEATURE_REGISTRY = [
  {
    key: FEATURE_KEYS.KOT,
    domain: "kitchen",
    label: "Kitchen Order Tickets",
    description: "Controls kitchen ticket workflows and queue visibility.",
  },
  {
    key: FEATURE_KEYS.BARCODE,
    domain: "sales-extensions",
    label: "Barcode",
    description: "Controls barcode generation and scanning support.",
  },
  {
    key: FEATURE_KEYS.TABLE_MANAGEMENT,
    domain: "sales-extensions",
    label: "Table Management",
    description: "Controls dining tables, reservations, and table-mode billing support.",
  },
  {
    key: FEATURE_KEYS.BATCH_TRACKING,
    domain: "inventory-advanced",
    label: "Batch Tracking",
    description: "Controls batch and expiry tracking features.",
  },
  {
    key: FEATURE_KEYS.OUTLET_INVENTORY_ALLOCATION,
    domain: "logistics",
    label: "Outlet Inventory Allocation",
    description: "Controls allocation of stock from central inventory to outlets.",
  },
  {
    key: FEATURE_KEYS.OUTLET_PURCHASE_ORDERS,
    domain: "logistics",
    label: "Outlet Purchase Orders",
    description: "Controls outlet demand and purchase-order workflows.",
  },
  {
    key: FEATURE_KEYS.DELIVERY_ROUTE_PLAN,
    domain: "logistics",
    label: "Delivery Route Plan",
    description: "Controls route planning and delivery scheduling.",
  },
];

export const FEATURE_KEYS_SET = new Set(FEATURE_REGISTRY.map((feature) => feature.key));
