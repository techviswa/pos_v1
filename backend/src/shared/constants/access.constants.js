export const STAFF_PERMISSION_KEYS = [
  "dashboard",
  "billing",
  "inventory",
  "reports",
  "products",
  "shift_swaps",
  "bills",
  "staff",
  "settings",
  "central_kitchen",
];

export const STAFF_ROLE_OPTIONS = ["Owner", "Manager", "Waiter", "Chef", "Cashier"];

export const ROLE_DEFAULT_PERMISSIONS = {
  Owner: STAFF_PERMISSION_KEYS,
  Manager: ["dashboard", "billing", "reports", "inventory", "products", "shift_swaps", "bills"],
  Waiter: ["billing", "bills"],
  Chef: [],
  Cashier: ["billing", "bills"],
};
