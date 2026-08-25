import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireSaasLimit } from "../../shared/middleware/saasLimit.middleware.js";
import { outletsController } from "./outlets.controller.js";

const router = Router();

router.get("/", asyncHandler(outletsController.list));
router.get("/:outletId", asyncHandler(outletsController.getById));
router.get("/:outletId/staff", asyncHandler(outletsController.listStaff));
router.put("/:outletId/staff", asyncHandler(outletsController.assignUsers));
router.get("/:outletId/products", asyncHandler(outletsController.listProducts));
router.put("/:outletId/products", asyncHandler(outletsController.updateProducts));
router.get("/:outletId/inventory", asyncHandler(outletsController.listInventory));
router.put("/:outletId/inventory", asyncHandler(outletsController.updateInventory));
router.get("/:outletId/features", asyncHandler(outletsController.listFeatures));
router.put("/:outletId/features", asyncHandler(outletsController.updateFeatures));
router.post("/", requireSaasLimit("outlets"), asyncHandler(outletsController.create));
router.put("/:outletId/assignments", asyncHandler(outletsController.assignUsers));
router.put("/:outletId", asyncHandler(outletsController.update));
router.delete("/:outletId", asyncHandler(outletsController.delete));

export default router;
