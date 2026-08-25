import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { dashboardController } from "./dashboard.controller.js";

const router = Router();

router.get("/stats", asyncHandler(dashboardController.stats));

export default router;
