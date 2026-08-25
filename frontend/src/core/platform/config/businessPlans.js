export const BUSINESS_PLANS = {
  starter: {
    key: "starter",
    label: "Starter",
    limits: {
      outlets: 1,
      staff: 10,
    },
  },
  growth: {
    key: "growth",
    label: "Growth",
    limits: {
      outlets: 5,
      staff: 50,
    },
  },
  enterprise: {
    key: "enterprise",
    label: "Enterprise",
    limits: {
      outlets: Infinity,
      staff: Infinity,
    },
  },
};

export const DEFAULT_BUSINESS_PLAN_KEY = "growth";

export const resolveBusinessPlan = (planKey = DEFAULT_BUSINESS_PLAN_KEY) =>
  BUSINESS_PLANS[planKey] || BUSINESS_PLANS[DEFAULT_BUSINESS_PLAN_KEY];
