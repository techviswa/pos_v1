import { createBusinessConfig } from "./businessConfigModel";
import { resolveBusinessTemplate } from "../templates/businessTemplates";
import { resolveBusinessPlan } from "./businessPlans";

const toArray = (value) => (Array.isArray(value) ? value : []);
const mergeUnique = (...values) => [...new Set(values.flatMap(toArray).filter(Boolean))];

export const resolveBusinessConfig = (inputConfig = {}) => {
  const config = createBusinessConfig(inputConfig);
  const template = resolveBusinessTemplate(config.templateKey);
  const plan = resolveBusinessPlan(config.planKey);

  const templateModules = toArray(template.enabledModules);
  const templateFeatures = toArray(template.enabledFeatures);
  const disabledModules = toArray(config.disabledModules);
  const disabledFeatures = toArray(config.disabledFeatures);
  const operationalRules = {
    ...(template.operationalRules || {}),
    ...(config.operationalRules || {}),
  };

  const enabledModules = mergeUnique(templateModules, config.enabledModules).filter(
    (moduleKey) => !disabledModules.includes(moduleKey),
  );
  const enabledFeatures = mergeUnique(templateFeatures, config.enabledFeatures).filter(
    (featureKey) => !disabledFeatures.includes(featureKey),
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
