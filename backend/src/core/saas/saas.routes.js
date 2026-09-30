import { Router } from "express";

import { requireAuth, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { saasController } from "./saas.controller.js";
import { saasBillingService } from "./saas-billing.service.js";
import { apiResponse } from "../../shared/utils/apiResponse.js";

const router = Router();

router.get("/plans", requireAuth, asyncHandler(saasController.listPlans));
router.get("/me", requireRole("Owner", "Manager"), asyncHandler(saasController.currentTenant));
// Plan & billing: paying Taskoora is the Owner's decision.
const billingContext = (req) => ({ businessId: req.context.businessId, tenantId: req.context.tenantId });
router.get("/billing/status", requireRole("Owner"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Plan and billing", data: await saasBillingService.status(billingContext(req)) }));
}));
router.post("/billing/checkout", requireRole("Owner"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Payment page ready", data: await saasBillingService.checkout(billingContext(req), req.user, req.body || {}) }));
}));
router.post("/billing/cancel", requireRole("Owner"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Automatic payment will stop at the end of the paid period", data: await saasBillingService.cancel(billingContext(req), req.user) }));
}));
router.get("/:businessId", requireRole("Owner", "Manager"), asyncHandler(saasController.getTenant));
router.get("/:businessId/usage", requireRole("Owner", "Manager"), asyncHandler(saasController.usage));

export default router;
