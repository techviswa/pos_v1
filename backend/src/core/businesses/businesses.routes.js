import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAdminCoreBridgeOrRole, requireRole, requirePermission, requireAuth } from "../../shared/middleware/authGuard.middleware.js";
import { readBusinessProfile, updateBusinessProfile } from './business-profile.js';
import { businessesController } from "./businesses.controller.js";

const router = Router();

router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await readBusinessProfile(req.context.businessId));
}));
router.put('/profile', requirePermission('settings'), asyncHandler(async (req, res) => {
  res.json(await updateBusinessProfile(req.context.businessId, req.body));
}));

router.get("/", requireRole("Owner", "Manager"), asyncHandler(businessesController.list));
// Creating a business is SaaS provisioning: AdminCore only. A tenant user can never mint another tenant.
router.post("/", requireAdminCoreBridgeOrRole(), asyncHandler(businessesController.create));
router.get("/:businessId", requireRole("Owner", "Manager"), asyncHandler(businessesController.getById));
router.put("/:businessId", requireRole("Owner", "Manager"), asyncHandler(businessesController.update));

export default router;

