import React from "react";
import { BillsWorkspace } from "../../../core/billing/pages/BillsWorkspace";
import { RestaurantFeatureGate } from "../components/RestaurantFeatureGate";

export const RestaurantBillsPage = () => (
  <RestaurantFeatureGate featureKey="billing">
    <BillsWorkspace />
  </RestaurantFeatureGate>
);
