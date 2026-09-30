import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAnyPermission } from "../../shared/middleware/authGuard.middleware.js";
import { tablesController } from "./tables.controller.js";

const router = Router();

router.get("/", requireAnyPermission("billing", "bills", "reports"), asyncHandler(tablesController.list));

export default router;
