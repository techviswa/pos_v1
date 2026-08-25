import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { deliveryRoutePlanController } from "./delivery-route-plan.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.DELIVERY_ROUTE_PLAN,
  definitions: [
    { method: "get", path: "/", handler: deliveryRoutePlanController.list },
    { method: "get", path: "/:routePlanId", handler: deliveryRoutePlanController.getById },
    { method: "post", path: "/", handler: deliveryRoutePlanController.create },
    { method: "put", path: "/:routePlanId", handler: deliveryRoutePlanController.update },
    { method: "post", path: "/:routePlanId/start", handler: deliveryRoutePlanController.start },
    { method: "post", path: "/:routePlanId/complete", handler: deliveryRoutePlanController.complete },
  ],
});
