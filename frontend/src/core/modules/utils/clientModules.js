export const CLIENT_MODULE_KEYS = ["restaurant", "kirana", "bakery"];

export const DEFAULT_CLIENT_MODULES = {
  restaurant: true,
  kirana: false,
  bakery: false,
};

export const CLIENT_MODULE_META = {
  restaurant: {
    key: "restaurant",
    label: "Restaurant",
    description: "Tables, KOT, billing, fulfillment, and dine-in operations.",
  },
  kirana: {
    key: "kirana",
    label: "Kirana",
    description: "Placeholder for grocery/retail workflows.",
  },
  bakery: {
    key: "bakery",
    label: "Bakery",
    description: "Placeholder for bakery-specific production and preorder workflows.",
  },
};

export const normalizeClientModules = (modules) => ({
  ...DEFAULT_CLIENT_MODULES,
  ...(modules || {}),
});

export const getClientModulesList = (modules) =>
  CLIENT_MODULE_KEYS.map((key) => ({
    ...CLIENT_MODULE_META[key],
    enabled: Boolean(normalizeClientModules(modules)[key]),
  }));

export const isClientModuleEnabled = (modules, key) =>
  Boolean(normalizeClientModules(modules)[key]);
