import { Router } from "express";

import { requireAdminCoreBridgeOrRole, requireRole, requirePermission, getEffectivePermissions, isAdminCoreBridgeRequest } from "../../shared/middleware/authGuard.middleware.js";
import { assertExportAccess } from './export-access.js';
import { syncHealth, reconcileSync } from "../admincore/sync-health.service.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { syncController } from "./sync.controller.js";

const router = Router();
router.get("/delivery-health", requirePermission("dashboard"), asyncHandler(async (req, res) => res.json({ success: true, data: await syncHealth({ businessId: req.context.businessId }) })));
router.post("/reconcile", requireRole("Owner", "Manager"), asyncHandler(async (req, res) => res.status(202).json({ success: true, data: await reconcileSync({ businessId: req.context.businessId, tenantId: req.context.tenantId }) })));

router.get("/strategy", asyncHandler(syncController.strategy));
router.get("/export/:resource", requireAdminCoreBridgeOrRole("Owner", "Manager"), (req, _res, next) => {
  try {
    assertExportAccess(req.params.resource, getEffectivePermissions(req.user), { bridge: isAdminCoreBridgeRequest(req) });
    next();
  } catch (error) { next(error); }
}, asyncHandler(syncController.exportResource));
router.get("/logs/admincore", requireAdminCoreBridgeOrRole("Owner", "Manager"), asyncHandler(syncController.listAdminCoreLogs));
router.post("/logs/admincore", requireAdminCoreBridgeOrRole("Owner", "Manager"), asyncHandler(syncController.recordAdminCoreLog));
router.get("/client-events", requireRole("Owner", "Manager"), asyncHandler(syncController.listEvents));
router.post("/client-events", asyncHandler(syncController.recordEvent));

export default router;
