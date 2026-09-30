import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAdminCoreBridgeOrRole, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { businessesController } from "./businesses.controller.js";

const router = Router();

router.get("/", requireRole("Owner", "Manager"), asyncHandler(businessesController.list));
// Creating a business is SaaS provisioning: AdminCore only. A tenant user can never mint another tenant.
router.post("/", requireAdminCoreBridgeOrRole(), asyncHandler(businessesController.create));
router.get("/:businessId", requireRole("Owner", "Manager"), asyncHandler(businessesController.getById));
router.put("/:businessId", requireRole("Owner", "Manager"), asyncHandler(businessesController.update));

export default router;

