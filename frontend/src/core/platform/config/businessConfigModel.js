import { DEFAULT_BUSINESS_TEMPLATE_KEY } from "../templates/businessTemplates";
import { DEFAULT_BUSINESS_PLAN_KEY } from "./businessPlans";

const toStringArray = (value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);
  }

  return [];
};

export const createBusinessConfig = (partial = {}) => ({
  businessId: partial.businessId || "internal-seed-business",
  businessName: partial.businessName || "CashFlow Lite POS",
  businessType: partial.businessType || "restaurant",
  templateKey: partial.templateKey || DEFAULT_BUSINESS_TEMPLATE_KEY,
  planKey: partial.planKey || DEFAULT_BUSINESS_PLAN_KEY,
  enabledModules: toStringArray(partial.enabledModules),
  disabledModules: toStringArray(partial.disabledModules),
  enabledFeatures: toStringArray(partial.enabledFeatures),
  disabledFeatures: toStringArray(partial.disabledFeatures),
  operationalRules: partial.operationalRules || {},
  metadata: partial.metadata || {},
});
