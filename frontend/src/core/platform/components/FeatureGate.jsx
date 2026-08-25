import React from "react";
import { Navigate } from "react-router-dom";
import { useBusinessTemplate } from "../store/useBusinessTemplate";

export const FeatureGate = ({ featureKey, children, fallbackPath = "/settings" }) => {
  const { isFeatureEnabled } = useBusinessTemplate();

  if (!isFeatureEnabled(featureKey)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return children;
};
