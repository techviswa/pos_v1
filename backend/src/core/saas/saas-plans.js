export const SAAS_PLANS = {
  starter: {
    key: "starter",
    name: "Starter",
    monthly_price: 999,
    limits: { outlets: 1, staff: 5, products: 250, qr_tables: 15, monthly_orders: 1000 },
    features: ["billing", "products", "reports", "staff", "table-management"],
  },
  growth: {
    key: "growth",
    name: "Growth",
    monthly_price: 2499,
    limits: { outlets: 3, staff: 25, products: 2000, qr_tables: 100, monthly_orders: 10000 },
    features: ["billing", "products", "reports", "staff", "table-management", "kot", "inventory"],
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    monthly_price: null,
    limits: { outlets: null, staff: null, products: null, qr_tables: null, monthly_orders: null },
    features: [
      "billing",
      "products",
      "reports",
      "staff",
      "table-management",
      "kot",
      "inventory",
      "barcode",
      "batch-tracking",
      "outlet-inventory-allocation",
      "outlet-purchase-orders",
      "delivery-route-plan",
    ],
  },
};

export const DEFAULT_SAAS_PLAN = "starter";
export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due"]);
export const SUBSCRIPTION_STATUSES = new Set(["trialing", "active", "past_due", "suspended", "expired", "cancelled"]);

// What a tenant may do in each lifecycle state. Data is never deleted or hidden from its owner:
//  full      - normal operation (trialing, active, past_due grace)
//  read_only - expired/cancelled: history stays viewable/exportable, new activity is refused
//  blocked   - suspended by Taskoora: no access until reactivated
export const accessModeForStatus = (status) => {
  if (status === "suspended") return "blocked";
  if (status === "expired" || status === "cancelled") return "read_only";
  return "full";
};

export const normalizeSubscriptionStatus = (status) => {
  const value = String(status ?? "").trim().toLowerCase();
  return value === "trial" ? "trialing" : value;
};

export const getPlan = (planKey) => SAAS_PLANS[planKey] || SAAS_PLANS[DEFAULT_SAAS_PLAN];

