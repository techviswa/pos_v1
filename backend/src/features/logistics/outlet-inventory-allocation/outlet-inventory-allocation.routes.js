import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { outletInventoryAllocationController } from "./outlet-inventory-allocation.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.OUTLET_INVENTORY_ALLOCATION,
  definitions: [
    { method: "get", path: "/", handler: outletInventoryAllocationController.list },
    { method: "get", path: "/:allocationId", handler: outletInventoryAllocationController.getById },
    { method: "post", path: "/", handler: outletInventoryAllocationController.create },
    { method: "put", path: "/:allocationId", handler: outletInventoryAllocationController.update },
    {
      method: "post",
      path: "/:allocationId/dispatch",
      handler: outletInventoryAllocationController.dispatch,
    },
    {
      method: "post",
      path: "/:allocationId/receive",
      handler: outletInventoryAllocationController.receive,
    },
  ],
});
