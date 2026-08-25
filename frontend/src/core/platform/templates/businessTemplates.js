import { FEATURE_REGISTRY } from "../features/featureRegistry";

export const BUSINESS_TEMPLATES = {
  restaurant: {
    key: "restaurant",
    label: "Restaurant",
    enabledModules: ["restaurant"],
    operationalRules: {
      dineInRequiresTableAssignment: true,
      dineInRequiresReservation: true,
    },
    enabledFeatures: [
      FEATURE_REGISTRY.billing.key,
      FEATURE_REGISTRY.payments.key,
      FEATURE_REGISTRY.users.key,
      FEATURE_REGISTRY.tables.key,
      FEATURE_REGISTRY.kot.key,
      FEATURE_REGISTRY.fulfillment_modes.key,
      FEATURE_REGISTRY.tokens.key,
      FEATURE_REGISTRY.pickup.key,
      FEATURE_REGISTRY.addons.key,
      FEATURE_REGISTRY.inventory.key,
      FEATURE_REGISTRY.reports.key,
      FEATURE_REGISTRY.staff.key,
      FEATURE_REGISTRY.products.key,
    ],
  },
  cafe: {
    key: "cafe",
    label: "Cafe",
    enabledModules: ["restaurant"],
    operationalRules: {
      dineInRequiresTableAssignment: true,
      dineInRequiresReservation: false,
    },
    enabledFeatures: [
      FEATURE_REGISTRY.billing.key,
      FEATURE_REGISTRY.payments.key,
      FEATURE_REGISTRY.users.key,
      FEATURE_REGISTRY.tables.key,
      FEATURE_REGISTRY.fulfillment_modes.key,
      FEATURE_REGISTRY.tokens.key,
      FEATURE_REGISTRY.pickup.key,
      FEATURE_REGISTRY.addons.key,
      FEATURE_REGISTRY.inventory.key,
      FEATURE_REGISTRY.reports.key,
      FEATURE_REGISTRY.products.key,
    ],
  },
  fast_food: {
    key: "fast_food",
    label: "Fast Food",
    enabledModules: ["restaurant"],
    operationalRules: {
      dineInRequiresTableAssignment: false,
      dineInRequiresReservation: false,
    },
    enabledFeatures: [
      FEATURE_REGISTRY.billing.key,
      FEATURE_REGISTRY.payments.key,
      FEATURE_REGISTRY.users.key,
      FEATURE_REGISTRY.fulfillment_modes.key,
      FEATURE_REGISTRY.tokens.key,
      FEATURE_REGISTRY.pickup.key,
      FEATURE_REGISTRY.addons.key,
      FEATURE_REGISTRY.inventory.key,
      FEATURE_REGISTRY.reports.key,
      FEATURE_REGISTRY.products.key,
    ],
  },
  kirana: {
    key: "kirana",
    label: "Kirana",
    enabledModules: ["kirana"],
    operationalRules: {
      dineInRequiresTableAssignment: false,
      dineInRequiresReservation: false,
    },
    enabledFeatures: [
      FEATURE_REGISTRY.billing.key,
      FEATURE_REGISTRY.payments.key,
      FEATURE_REGISTRY.users.key,
      FEATURE_REGISTRY.barcode.key,
      FEATURE_REGISTRY.batch_tracking.key,
      FEATURE_REGISTRY.inventory.key,
      FEATURE_REGISTRY.reports.key,
      FEATURE_REGISTRY.staff.key,
      FEATURE_REGISTRY.products.key,
    ],
  },
  bakery: {
    key: "bakery",
    label: "Bakery",
    enabledModules: ["bakery", "restaurant"],
    operationalRules: {
      dineInRequiresTableAssignment: false,
      dineInRequiresReservation: false,
    },
    enabledFeatures: [
      FEATURE_REGISTRY.billing.key,
      FEATURE_REGISTRY.payments.key,
      FEATURE_REGISTRY.users.key,
      FEATURE_REGISTRY.pickup.key,
      FEATURE_REGISTRY.addons.key,
      FEATURE_REGISTRY.batch_tracking.key,
      FEATURE_REGISTRY.inventory.key,
      FEATURE_REGISTRY.reports.key,
      FEATURE_REGISTRY.staff.key,
      FEATURE_REGISTRY.products.key,
    ],
  },
};

export const DEFAULT_BUSINESS_TEMPLATE_KEY = "restaurant";

export const resolveBusinessTemplate = (templateKey = DEFAULT_BUSINESS_TEMPLATE_KEY) =>
  BUSINESS_TEMPLATES[templateKey] || BUSINESS_TEMPLATES[DEFAULT_BUSINESS_TEMPLATE_KEY];
