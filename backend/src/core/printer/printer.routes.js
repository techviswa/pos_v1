import { Router } from "express";

import { requireAnyPermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { printerController } from "./printer.controller.js";

const router = Router();

router.post("/agent/heartbeat", asyncHandler(printerController.agentHeartbeat));
router.post("/agent/claim-next", asyncHandler(printerController.claimNext));
router.post("/agent/jobs/:jobId/complete", asyncHandler(printerController.complete));
router.post("/agent/jobs/:jobId/fail", asyncHandler(printerController.fail));
router.get("/agents", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.listAgents));
router.get("/", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.list));
router.post("/", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.create));
router.get("/:jobId", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.getById));
router.post("/:jobId/complete", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.complete));
router.post("/:jobId/fail", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.fail));

export default router;
