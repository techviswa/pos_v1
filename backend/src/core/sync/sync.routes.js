import { Router } from "express";

import { requireAdminCoreBridgeOrRole, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { syncController } from "./sync.controller.js";

const router = Router();

router.get("/strategy", asyncHandler(syncController.strategy));
router.get("/export/:resource", requireAdminCoreBridgeOrRole("Owner", "Manager"), asyncHandler(syncController.exportResource));
router.get("/logs/admincore", requireAdminCoreBridgeOrRole("Owner", "Manager"), asyncHandler(syncController.listAdminCoreLogs));
router.post("/logs/admincore", requireAdminCoreBridgeOrRole("Owner", "Manager"), asyncHandler(syncController.recordAdminCoreLog));
router.get("/client-events", requireRole("Owner", "Manager"), asyncHandler(syncController.listEvents));
router.post("/client-events", asyncHandler(syncController.recordEvent));

export default router;
