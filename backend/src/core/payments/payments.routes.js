import { Router } from "express";

import { requireAnyPermission, requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { paymentsController } from "./payments.controller.js";

const router = Router();

router.post("/public/intents", asyncHandler(paymentsController.createPublic));
router.post("/webhooks/:provider", asyncHandler(paymentsController.webhook));
router.get("/", requireAnyPermission("billing", "bills", "reports"), asyncHandler(paymentsController.listAll));
router.get("/intents", requireAnyPermission("billing", "bills", "reports"), asyncHandler(paymentsController.list));
router.post("/intents", requirePermission("billing"), asyncHandler(paymentsController.create));
router.get("/intents/:intentId", requireAnyPermission("billing", "bills"), asyncHandler(paymentsController.getById));
router.post("/intents/:intentId/confirm", requirePermission("billing"), asyncHandler(paymentsController.confirm));

export default router;
