// One key per screen. A screen key also unlocks the actions that screen performs; decisions that need manager
// authority (refunds, void approval, payment confirmation, open prices, large discounts) stay tied to the role.
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
  "reservations",
  "qr_management",
  "manager_view",
  "waiter_view",
  "kitchen_view",
  "price_rules",
  "attendance",
  "tips",
  "customers",
  "gift_cards",
  "payroll",
  "marketing",
];

export const PERMISSION_LABELS = {
  dashboard: "Dashboard",
  billing: "Billing",
  inventory: "Inventory",
  reports: "Reports",
  products: "Products / menu",
  shift_swaps: "Shift swaps",
  bills: "Bills",
  staff: "Staff",
  settings: "Settings",
  central_kitchen: "Central kitchen",
  reservations: "Reservations",
  qr_management: "QR & tables",
  manager_view: "Manager screen",
  waiter_view: "Waiter screen",
  kitchen_view: "Kitchen screen",
  price_rules: "Happy hours",
  attendance: "Team attendance",
  tips: "Tips",
  customers: "Customers & loyalty",
  gift_cards: "Gift cards",
  payroll: "Payroll",
  marketing: "Marketing (WhatsApp/SMS)",
};

export const STAFF_ROLE_OPTIONS = ["Owner", "Manager", "Waiter", "Chef", "Cashier"];

export const ROLE_DEFAULT_PERMISSIONS = {
  Owner: STAFF_PERMISSION_KEYS,
  Manager: [
    "dashboard", "billing", "reports", "inventory", "products", "shift_swaps", "bills", "staff",
    "reservations", "qr_management", "manager_view", "price_rules", "attendance", "tips", "customers", "gift_cards",
  ],
  Waiter: ["billing", "bills", "waiter_view"],
  Chef: ["kitchen_view"],
  Cashier: ["billing", "bills", "gift_cards"],
};
