import React from "react";
import { ModuleGate } from "../../../core/modules/components/ModuleGate";

export const RestaurantModuleGate = ({ children }) => (
  <ModuleGate fallbackPath="/settings" moduleKey="restaurant">
    {children}
  </ModuleGate>
);
