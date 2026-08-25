import { Router } from "express";

import {
  getConnection,
  getHealth,
  getSaasExport,
  getSaasTenant,
  getSaasUsage,
  postSaasTenant,
  postSyncStatus,
  putSaasDomains,
  putSaasSubscription,
} from "./admincore.controller.js";

const router = Router();

router.get("/connection", getConnection);
router.get("/health", getHealth);
router.post("/sync-status", postSyncStatus);
router.post("/tenants", postSaasTenant);
router.get("/tenants/:businessId", getSaasTenant);
router.put("/tenants/:businessId/subscription", putSaasSubscription);
router.put("/tenants/:businessId/domains", putSaasDomains);
router.get("/tenants/:businessId/usage", getSaasUsage);
router.get("/tenants/:businessId/export", getSaasExport);

export default router;
