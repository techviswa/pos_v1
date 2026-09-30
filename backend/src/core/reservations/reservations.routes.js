import { Router } from "express";

import { requireAnyPermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { reservationsController } from "./reservations.controller.js";

const router = Router();

router.get("/", requireAnyPermission("reservations", "waiter_view", "manager_view"), asyncHandler(reservationsController.list));

export default router;
