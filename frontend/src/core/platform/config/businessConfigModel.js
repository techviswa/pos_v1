import { DEFAULT_BUSINESS_TEMPLATE_KEY } from "../templates/businessTemplates";
import { DEFAULT_BUSINESS_PLAN_KEY } from "./businessPlans";

export const createBusinessConfig = (partial = {}) => ({
  businessId: partial.businessId || "internal-seed-business",
  businessName: partial.businessName || "CashFlow Lite POS",
  businessType: partial.businessType || "restaurant",
  templateKey: partial.templateKey || DEFAULT_BUSINESS_TEMPLATE_KEY,
  planKey: partial.planKey || DEFAULT_BUSINESS_PLAN_KEY,
  enabledModules: partial.enabledModules || [],
  disabledModules: partial.disabledModules || [],
  enabledFeatures: partial.enabledFeatures || [],
  disabledFeatures: partial.disabledFeatures || [],
  operationalRules: partial.operationalRules || {},
  metadata: partial.metadata || {},
});
