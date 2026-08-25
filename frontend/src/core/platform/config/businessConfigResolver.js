import { createBusinessConfig } from "./businessConfigModel";
import { resolveBusinessTemplate } from "../templates/businessTemplates";
import { resolveBusinessPlan } from "./businessPlans";

const mergeUnique = (...values) => [...new Set(values.flat().filter(Boolean))];

export const resolveBusinessConfig = (inputConfig = {}) => {
  const config = createBusinessConfig(inputConfig);
  const template = resolveBusinessTemplate(config.templateKey);
  const plan = resolveBusinessPlan(config.planKey);

  const templateModules = template.enabledModules || [];
  const templateFeatures = template.enabledFeatures || [];
  const operationalRules = {
    ...(template.operationalRules || {}),
    ...(config.operationalRules || {}),
  };

  const enabledModules = mergeUnique(templateModules, config.enabledModules).filter(
    (moduleKey) => !(config.disabledModules || []).includes(moduleKey),
  );
  const enabledFeatures = mergeUnique(templateFeatures, config.enabledFeatures).filter(
    (featureKey) => !(config.disabledFeatures || []).includes(featureKey),
  );

  return {
    ...config,
    template,
    plan,
    resolvedTemplateKey: template.key,
    resolvedBusinessType: config.businessType || template.key,
    enabledModules,
    enabledFeatures,
    operationalRules,
  };
};
