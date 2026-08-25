import React from "react";
import { BillingWorkspace } from "../../../core/billing/pages/BillingWorkspace";
import { RestaurantFeatureGate } from "../components/RestaurantFeatureGate";

export const RestaurantBillingPage = () => (
  <RestaurantFeatureGate featureKey="billing">
    <BillingWorkspace />
  </RestaurantFeatureGate>
);
