import { Router } from "express";

import { requireAnyPermission, requirePermission, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { apiResponse } from "../../shared/utils/apiResponse.js";
import { gatewayService } from "./gateway.service.js";
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
router.post("/intents/:intentId/refresh", requirePermission("billing"), asyncHandler(paymentsController.refresh));
router.post("/intents/:intentId/cancel", requirePermission("billing"), asyncHandler(paymentsController.cancel));

// Razorpay account of this business. Keys are an Owner decision; the till only asks whether Razorpay is on.
const scope = (req) => ({ businessId: req.context.businessId });
router.get("/gateway/status", requireAnyPermission("billing", "bills"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Payment gateway", data: await gatewayService.status(scope(req)) }));
}));
router.get("/gateway", requireRole("Owner", "Manager"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Payment gateway", data: await gatewayService.getConfig(scope(req)) }));
}));
router.put("/gateway", requireRole("Owner"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Payment gateway saved", data: await gatewayService.saveConfig({ ...scope(req), payload: req.body || {} }) }));
}));
router.post("/gateway/webhook-secret", requireRole("Owner"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Copy this secret into Razorpay now; it is not shown again", data: await gatewayService.generateWebhookSecret(scope(req)) }));
}));

export default router;
