import { Router } from "express";

import { requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { reservationsController } from "./reservations.controller.js";

const router = Router();

router.get("/", requireRole("Owner", "Manager", "Waiter"), asyncHandler(reservationsController.list));

export default router;
