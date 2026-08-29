import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAuth, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { featuresController } from "./features.controller.js";

const router = Router();

router.get("/", requireAuth, asyncHandler(featuresController.list));
router.get("/:businessId", requireAuth, asyncHandler(featuresController.list));
router.put("/:businessId", requireRole("Owner", "Manager"), asyncHandler(featuresController.update));
router.post("/:businessId/:featureKey/enable", requireRole("Owner", "Manager"), asyncHandler(featuresController.enable));
router.post("/:businessId/:featureKey/disable", requireRole("Owner", "Manager"), asyncHandler(featuresController.disable));

export default router;
