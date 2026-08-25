import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { batchTrackingController } from "./batch-tracking.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.BATCH_TRACKING,
  definitions: [
    { method: "get", path: "/", handler: batchTrackingController.list },
    { method: "post", path: "/", handler: batchTrackingController.create },
  ],
});
