import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { outletPurchaseOrdersController } from "./outlet-purchase-orders.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.OUTLET_PURCHASE_ORDERS,
  definitions: [
    { method: "get", path: "/", handler: outletPurchaseOrdersController.list },
    { method: "get", path: "/:purchaseOrderId", handler: outletPurchaseOrdersController.getById },
    { method: "post", path: "/", handler: outletPurchaseOrdersController.create },
    { method: "put", path: "/:purchaseOrderId", handler: outletPurchaseOrdersController.update },
    {
      method: "post",
      path: "/:purchaseOrderId/approve",
      handler: outletPurchaseOrdersController.approve,
    },
    {
      method: "post",
      path: "/:purchaseOrderId/reject",
      handler: outletPurchaseOrdersController.reject,
    },
  ],
});
