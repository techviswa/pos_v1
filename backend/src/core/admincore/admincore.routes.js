import { Router } from "express";

import {
  getConnection,
  getHealth,
  getSaasExport,
  getSaasTenant,
  getSaasUsage,
  postBridgeStaff,
  postSaasTenant,
  postSyncStatus,
  putSaasDomains,
  putSaasSubscription,
} from "./admincore.controller.js";
import env from "../../config/env.js";
import { createHttpError } from "../../shared/utils/http-error.js";

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

  if (candidate !== bridgeKey) {
    return next(createHttpError({ statusCode: 401, code: "ADMINCORE_BRIDGE_UNAUTHORIZED", message: "Invalid AdminCore bridge key" }));
  }

  return next();
};

router.get("/connection", getConnection);
router.get("/health", getHealth);
router.post("/sync-status", postSyncStatus);
router.post("/tenants", requireAdmincoreBridgeKey, postSaasTenant);
router.post("/staff", requireAdmincoreBridgeKey, postBridgeStaff);
router.get("/tenants/:businessId", getSaasTenant);
router.put("/tenants/:businessId/subscription", requireAdmincoreBridgeKey, putSaasSubscription);
router.put("/tenants/:businessId/domains", requireAdmincoreBridgeKey, putSaasDomains);
router.get("/tenants/:businessId/usage", getSaasUsage);
router.get("/tenants/:businessId/export", getSaasExport);

export default router;
