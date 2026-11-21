import { Router } from "express";
import { requirePermission } from "../../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../../shared/utils/asyncHandler.js";
import { qrExperienceService } from "./qr-experience.service.js";
import { qrServiceAnalytics } from "./qr-service-analytics.js";

const router = Router();
const scope = (req) => ({ businessId: req.context.businessId, outletIds: req.query.outlet_id ? [req.query.outlet_id] : req.context.outletScope });
router.get("/analytics/service", requirePermission("reports"), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json({ success: true, data: await qrServiceAnalytics({ ...scope(req), query: req.query }) });
}));
router.post("/analytics/feedback/:feedbackId", requirePermission("manager_view"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qrExperienceService.followUp({ ...scope(req), feedbackId: req.params.feedbackId, payload: req.body || {}, user: req.user }) });
}));
router.get("/orders/:trackingToken/feedback", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ success: true, data: await qrExperienceService.form(req.params) });
}));
router.post("/orders/:trackingToken/feedback", asyncHandler(async (req, res) => {
  const data = await qrExperienceService.submit({ ...req.params, payload: req.body || {} });
  res.status(data.duplicate ? 200 : 201).json({ success: true, data });
}));
export default router;
