import { requireRole } from "../../../shared/middleware/authGuard.middleware.js";
import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { outletInventoryAllocationController } from "./outlet-inventory-allocation.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.OUTLET_INVENTORY_ALLOCATION,
  definitions: [
    { method: "get", path: "/", handler: outletInventoryAllocationController.list },
    { method: "get", path: "/:allocationId", handler: outletInventoryAllocationController.getById },
    { method: "post", path: "/", middleware: requireRole("Owner", "Manager"), handler: outletInventoryAllocationController.create },
    { method: "put", path: "/:allocationId", middleware: requireRole("Owner", "Manager"), handler: outletInventoryAllocationController.update },
    {
      method: "post",
      path: "/:allocationId/dispatch",
      middleware: requireRole("Owner", "Manager"),
      handler: outletInventoryAllocationController.dispatch,
    },
    {
      method: "post",
      path: "/:allocationId/receive",
      middleware: requireRole("Owner", "Manager"),
      handler: outletInventoryAllocationController.receive,
    },
  ],
});
