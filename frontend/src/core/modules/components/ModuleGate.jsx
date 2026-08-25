import React from "react";
import { Navigate } from "react-router-dom";
import { useClientModules } from "../store/useClientModules";

export const ModuleGate = ({ moduleKey, children, fallbackPath = "/settings" }) => {
  const { isModuleEnabled } = useClientModules();

  if (!isModuleEnabled(moduleKey)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
};
