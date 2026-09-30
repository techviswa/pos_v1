import { requireRole } from "../../../shared/middleware/authGuard.middleware.js";
import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { deliveryRoutePlanController } from "./delivery-route-plan.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.DELIVERY_ROUTE_PLAN,
  definitions: [
    { method: "get", path: "/", handler: deliveryRoutePlanController.list },
    { method: "get", path: "/:routePlanId", handler: deliveryRoutePlanController.getById },
    { method: "post", path: "/", middleware: requireRole("Owner", "Manager"), handler: deliveryRoutePlanController.create },
    { method: "put", path: "/:routePlanId", middleware: requireRole("Owner", "Manager"), handler: deliveryRoutePlanController.update },
    { method: "post", path: "/:routePlanId/start", middleware: requireRole("Owner", "Manager"), handler: deliveryRoutePlanController.start },
    { method: "post", path: "/:routePlanId/complete", middleware: requireRole("Owner", "Manager"), handler: deliveryRoutePlanController.complete },
  ],
});
