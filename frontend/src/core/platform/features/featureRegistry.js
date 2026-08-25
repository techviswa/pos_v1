export const FEATURE_REGISTRY = {
  billing: {
    key: "billing",
    label: "Billing",
    domain: "core",
  },
  payments: {
    key: "payments",
    label: "Payments",
    domain: "core",
  },
  users: {
    key: "users",
    label: "Users",
    domain: "core",
  },
  tables: {
    key: "tables",
    label: "Table Management",
    domain: "restaurant",
  },
  kot: {
    key: "kot",
    label: "KOT",
    domain: "restaurant",
  },
  fulfillment_modes: {
    key: "fulfillment_modes",
    label: "Fulfillment Modes",
    domain: "restaurant",
  },
  tokens: {
    key: "tokens",
    label: "Token Billing",
    domain: "restaurant",
  },
  pickup: {
    key: "pickup",
    label: "Pickup Scheduling",
    domain: "restaurant",
  },
  addons: {
    key: "addons",
    label: "Add-ons",
    domain: "restaurant",
  },
  barcode: {
    key: "barcode",
    label: "Barcode Scanning",
    domain: "retail",
  },
  batch_tracking: {
    key: "batch_tracking",
    label: "Batch Tracking",
    domain: "retail",
  },
  inventory: {
    key: "inventory",
    label: "Inventory",
    domain: "shared",
  },
  reports: {
    key: "reports",
    label: "Reports",
    domain: "shared",
  },
  staff: {
    key: "staff",
    label: "Staff",
    domain: "shared",
  },
  products: {
    key: "products",
    label: "Products",
    domain: "shared",
  },
};

export const FEATURE_REGISTRY_LIST = Object.values(FEATURE_REGISTRY);
