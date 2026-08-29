import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAnyPermission, requireAuth, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { requireSaasLimit } from "../../shared/middleware/saasLimit.middleware.js";
import { outletsController } from "./outlets.controller.js";

const router = Router();

router.get("/", requireAuth, asyncHandler(outletsController.list));
router.get("/:outletId", requireAuth, asyncHandler(outletsController.getById));
router.get("/:outletId/staff", requireRole("Owner", "Manager"), asyncHandler(outletsController.listStaff));
router.put("/:outletId/staff", requireRole("Owner", "Manager"), asyncHandler(outletsController.assignUsers));
router.get("/:outletId/products", requireAnyPermission("products", "billing", "reports"), asyncHandler(outletsController.listProducts));
router.put("/:outletId/products", requireRole("Owner", "Manager"), asyncHandler(outletsController.updateProducts));
router.get("/:outletId/inventory", requireAnyPermission("inventory", "reports"), asyncHandler(outletsController.listInventory));
router.put("/:outletId/inventory", requireAnyPermission("inventory", "central_kitchen"), asyncHandler(outletsController.updateInventory));
router.get("/:outletId/features", requireRole("Owner", "Manager"), asyncHandler(outletsController.listFeatures));
router.put("/:outletId/features", requireRole("Owner", "Manager"), asyncHandler(outletsController.updateFeatures));
router.post("/", requireRole("Owner", "Manager"), requireSaasLimit("outlets"), asyncHandler(outletsController.create));
router.put("/:outletId/assignments", requireRole("Owner", "Manager"), asyncHandler(outletsController.assignUsers));
router.put("/:outletId", requireRole("Owner", "Manager"), asyncHandler(outletsController.update));
router.delete("/:outletId", requireRole("Owner", "Manager"), asyncHandler(outletsController.delete));

export default router;
