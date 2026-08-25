import React from "react";
import { FeatureGate } from "../../../core/platform/components/FeatureGate";
import { RestaurantModuleGate } from "./RestaurantModuleGate";

export const RestaurantFeatureGate = ({ featureKey, children, fallbackPath = "/settings" }) => (
  <RestaurantModuleGate>
    <FeatureGate fallbackPath={fallbackPath} featureKey={featureKey}>
      {children}
    </FeatureGate>
  </RestaurantModuleGate>
);
