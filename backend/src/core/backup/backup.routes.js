import { Router } from "express";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { backupService } from "./backup.service.js";
import { saasService } from "../saas/saas.service.js";
import { localDate } from "../../shared/utils/business-time.js";

const router = Router();

// The platform's nightly off-site backup as it concerns this business (Settings).
router.get("/status", requirePermission("settings"), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json({ success: true, data: await backupService.statusFor(req.context.businessId) });
}));

// The owner's own copy of everything this business holds, as one JSON file.
router.get("/my-data", requireRole("Owner"), asyncHandler(async (req, res) => {
  res.status(200).type("application/json");
  res.set("Cache-Control", "private, no-store");
  res.set("Content-Disposition", `attachment; filename="business-data-${localDate(new Date())}.json"`);
  const write = (chunk) => (res.write(chunk) ? undefined : new Promise((resolve) => res.once("drain", resolve)));
  await saasService.streamTenantExport({ businessId: req.context.businessId, write });
  res.end();
}));

export default router;
