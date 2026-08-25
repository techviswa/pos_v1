import { FEATURE_KEYS } from "../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../shared/utils/create-feature-router.js";
import { barcodeController } from "./barcode.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.BARCODE,
  definitions: [
    { method: "get", path: "/", handler: barcodeController.list },
    { method: "post", path: "/generate", handler: barcodeController.generate },
  ],
});
