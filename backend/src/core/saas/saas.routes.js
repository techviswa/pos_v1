import { Router } from "express";

import { requireAuth, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { saasController } from "./saas.controller.js";

const router = Router();

router.get("/plans", requireAuth, asyncHandler(saasController.listPlans));
router.get("/me", requireRole("Owner", "Manager"), asyncHandler(saasController.currentTenant));
router.get("/:businessId", requireRole("Owner", "Manager"), asyncHandler(saasController.getTenant));
router.get("/:businessId/usage", requireRole("Owner", "Manager"), asyncHandler(saasController.usage));

export default router;
