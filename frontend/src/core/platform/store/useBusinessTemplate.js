import { useMemo } from "react";
import { FEATURE_REGISTRY } from "../features/featureRegistry";
import { getActiveBusinessConfig } from "../config/activeBusinessConfig";

export const useBusinessTemplate = () => {
  const businessConfig = useMemo(() => getActiveBusinessConfig(), []);
  const activeTemplate = businessConfig.template;
  const operationalRules = businessConfig.operationalRules || activeTemplate?.operationalRules || {};
  const enabledFeatures = useMemo(
    () => new Set(businessConfig.enabledFeatures || []),
    [businessConfig.enabledFeatures],
  );
  const enabledModules = useMemo(
    () => new Set(businessConfig.enabledModules || []),
    [businessConfig.enabledModules],
  );

  return {
    businessConfig,
    activeTemplate,
    operationalRules,
    enabledFeatures,
    enabledModules,
    isFeatureEnabled: (featureKey) => enabledFeatures.has(featureKey),
    isModuleEnabled: (moduleKey) => enabledModules.has(moduleKey),
    getFeatureDefinition: (featureKey) => FEATURE_REGISTRY[featureKey] || null,
  };
};
