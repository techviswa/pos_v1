import { Router } from "express";
import { readBusinessProfile, updateBusinessProfile } from '../businesses/business-profile.js';

import {
  getConnection,
  getHealth,
  getSaasExport,
  getSaasTenant,
  getSaasUsage,
  deleteBridgeOutlet,
  deleteBridgeProduct,
  postBridgeOutlet,
  postBridgeStaff,
  putBridgeStaff,
  postBridgeProduct,
  postSaasTenant,
  postSyncStatus,
  putBridgeOutlet,
  putBridgeProduct,
  putSaasDomains,
  putSaasSubscription,
} from "./admincore.controller.js";
import { safeEqual } from "../../shared/middleware/authGuard.middleware.js";
import env from "../../config/env.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";

const router = Router();

const getBearerToken = (authorization = "") => {
  const [scheme, token] = String(authorization || "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
};

const requireAdmincoreBridgeKey = (req, _res, next) => {
  const bridgeKey = env.admincore.apiKey;
  const candidate = req.get("x-admincore-api-key") || req.get("x-api-key") || getBearerToken(req.get("authorization"));

  if (!env.admincore.enabled || !bridgeKey) {
    return next(createHttpError({ statusCode: 503, code: "ADMINCORE_BRIDGE_NOT_CONFIGURED", message: "AdminCore bridge is not configured" }));
  }

  if (!safeEqual(candidate, bridgeKey)) {
    return next(createHttpError({ statusCode: 401, code: "ADMINCORE_BRIDGE_UNAUTHORIZED", message: "Invalid AdminCore bridge key" }));
  }

  return next();
};

router.get("/connection", asyncHandler(getConnection));
router.get('/business-profile/:businessId', requireAdmincoreBridgeKey, asyncHandler(async (req, res) => {
  const profile = await readBusinessProfile(req.params.businessId);
  if (!req.query.tenant_id || profile.tenant_id !== req.query.tenant_id) throw createHttpError({ statusCode: 403, message: 'Business tenant mismatch' });
  res.json({ success: true, data: profile });
}));
router.put('/business-profile/:businessId', requireAdmincoreBridgeKey, asyncHandler(async (req, res) => {
  const profile = await readBusinessProfile(req.params.businessId);
  if (!req.body?.tenant_id || profile.tenant_id !== req.body.tenant_id) throw createHttpError({ statusCode: 403, message: 'Business tenant mismatch' });
  res.json({ success: true, data: await updateBusinessProfile(req.params.businessId, req.body) });
}));
router.get("/health", asyncHandler(getHealth));
router.get("/capabilities", requireAdmincoreBridgeKey, (_req, res) => res.json({ success: true, data: { product_commands: 1, outlet_commands: 1, export_paging: 3, privacy_erasures: 1, frozen_exports: 1, actor_checks: 1 } }));
router.post("/sync-status", requireAdmincoreBridgeKey, asyncHandler(postSyncStatus));
router.post("/tenants", requireAdmincoreBridgeKey, asyncHandler(postSaasTenant));
router.post("/staff", requireAdmincoreBridgeKey, asyncHandler(postBridgeStaff));
router.put("/staff/:userId", requireAdmincoreBridgeKey, asyncHandler(putBridgeStaff));
router.post("/outlets", requireAdmincoreBridgeKey, asyncHandler(postBridgeOutlet));
router.put("/outlets/:outletId", requireAdmincoreBridgeKey, asyncHandler(putBridgeOutlet));
router.delete("/outlets/:outletId", requireAdmincoreBridgeKey, asyncHandler(deleteBridgeOutlet));
router.post("/products", requireAdmincoreBridgeKey, asyncHandler(postBridgeProduct));
router.put("/products/:productId", requireAdmincoreBridgeKey, asyncHandler(putBridgeProduct));
router.delete("/products/:productId", requireAdmincoreBridgeKey, asyncHandler(deleteBridgeProduct));
router.get("/tenants/:businessId", requireAdmincoreBridgeKey, asyncHandler(getSaasTenant));
router.put("/tenants/:businessId/subscription", requireAdmincoreBridgeKey, asyncHandler(putSaasSubscription));
router.put("/tenants/:businessId/domains", requireAdmincoreBridgeKey, asyncHandler(putSaasDomains));
router.get("/tenants/:businessId/usage", requireAdmincoreBridgeKey, asyncHandler(getSaasUsage));
router.get("/tenants/:businessId/export", requireAdmincoreBridgeKey, asyncHandler(getSaasExport));

export default router;
