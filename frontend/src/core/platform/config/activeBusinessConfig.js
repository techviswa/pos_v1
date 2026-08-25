import { resolveBusinessConfig } from "./businessConfigResolver";

// Internal-only platform config.
// This can later be replaced by a database/admin-driven source without changing consumers.
export const ACTIVE_BUSINESS_CONFIG = {
  businessId: "internal-seed-business",
  businessName: "CashFlow Lite Restaurant Demo",
  businessType: "restaurant",
  templateKey: "restaurant",
  planKey: "growth",
  enabledModules: [],
  disabledModules: [],
  enabledFeatures: [],
  disabledFeatures: [],
  metadata: {
    source: "internal-config",
  },
};

export const getActiveBusinessConfig = () => resolveBusinessConfig(ACTIVE_BUSINESS_CONFIG);
