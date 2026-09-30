import { requireRole } from "../../../shared/middleware/authGuard.middleware.js";
import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { outletPurchaseOrdersController } from "./outlet-purchase-orders.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.OUTLET_PURCHASE_ORDERS,
  definitions: [
    { method: "get", path: "/", handler: outletPurchaseOrdersController.list },
    { method: "get", path: "/:purchaseOrderId", handler: outletPurchaseOrdersController.getById },
    { method: "post", path: "/", middleware: requireRole("Owner", "Manager"), handler: outletPurchaseOrdersController.create },
    { method: "put", path: "/:purchaseOrderId", middleware: requireRole("Owner", "Manager"), handler: outletPurchaseOrdersController.update },
    {
      method: "post",
      path: "/:purchaseOrderId/approve",
      middleware: requireRole("Owner", "Manager"),
      handler: outletPurchaseOrdersController.approve,
    },
    {
      method: "post",
      path: "/:purchaseOrderId/reject",
      middleware: requireRole("Owner", "Manager"),
      handler: outletPurchaseOrdersController.reject,
    },
  ],
});
