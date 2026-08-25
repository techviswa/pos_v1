import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { businessesController } from "./businesses.controller.js";

const router = Router();

router.get("/", asyncHandler(businessesController.list));
router.post("/", requireRole("Owner", "Manager"), asyncHandler(businessesController.create));
router.get("/:businessId", asyncHandler(businessesController.getById));
router.put("/:businessId", requireRole("Owner", "Manager"), asyncHandler(businessesController.update));

export default router;

