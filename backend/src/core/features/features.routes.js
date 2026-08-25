import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { featuresController } from "./features.controller.js";

const router = Router();

router.get("/", asyncHandler(featuresController.list));
router.get("/:businessId", asyncHandler(featuresController.list));
router.put("/:businessId", asyncHandler(featuresController.update));
router.post("/:businessId/:featureKey/enable", asyncHandler(featuresController.enable));
router.post("/:businessId/:featureKey/disable", asyncHandler(featuresController.disable));

export default router;
