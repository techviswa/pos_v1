import { useMemo } from "react";
import { useBusinessTemplate } from "../../platform/store/useBusinessTemplate";
import {
  getClientModulesList,
  isClientModuleEnabled,
  normalizeClientModules,
} from "../utils/clientModules";

export const useClientModules = () => {
  const { activeTemplate, businessConfig } = useBusinessTemplate();
  const modules = useMemo(
    () =>
      normalizeClientModules(
        Object.fromEntries((businessConfig.enabledModules || []).map((moduleKey) => [moduleKey, true])),
      ),
    [businessConfig.enabledModules],
  );

  return {
    businessConfig,
    activeTemplate,
    modules,
    moduleList: getClientModulesList(modules),
    isModuleEnabled: (moduleKey) => isClientModuleEnabled(modules, moduleKey),
  };
};
