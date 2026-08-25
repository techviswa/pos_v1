import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { saasController } from "./saas.controller.js";

const router = Router();

router.get("/plans", asyncHandler(saasController.listPlans));
router.get("/me", asyncHandler(saasController.currentTenant));
router.get("/:businessId", asyncHandler(saasController.getTenant));
router.get("/:businessId/usage", asyncHandler(saasController.usage));

export default router;

