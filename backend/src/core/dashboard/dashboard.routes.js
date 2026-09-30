import { Router } from "express";

import { requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { dashboardController } from "./dashboard.controller.js";

import { scopeOutletQuery } from "../../shared/middleware/recordOutletGuards.js";

const router = Router();

router.get("/stats", requirePermission("dashboard"), scopeOutletQuery, asyncHandler(dashboardController.stats));

export default router;
