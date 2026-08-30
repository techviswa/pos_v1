import { Router } from "express";

import { requireAnyPermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { customersController } from "./customers.controller.js";

const router = Router();

router.get("/", requireAnyPermission("billing", "bills", "reports"), asyncHandler(customersController.list));

export default router;
