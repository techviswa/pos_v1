import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAnyPermission, requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { requireSaasLimit } from "../../shared/middleware/saasLimit.middleware.js";
import { productsController } from "./products.controller.js";

const router = Router();

router.get("/", requireAnyPermission("products", "billing", "reports"), asyncHandler(productsController.list));
router.get("/catalog", requireAnyPermission("products", "billing", "reports"), asyncHandler(productsController.catalog));
router.get("/:productId", requireAnyPermission("products", "billing", "reports"), asyncHandler(productsController.getById));
router.post("/", requirePermission("products"), requireSaasLimit("products"), asyncHandler(productsController.create));
router.put("/:productId", requirePermission("products"), asyncHandler(productsController.update));
router.delete("/:productId", requirePermission("products"), asyncHandler(productsController.delete));
router.post("/:productId/stock-adjustments", requirePermission("inventory"), asyncHandler(productsController.stockAdjustment));
router.put("/:productId/variations", requirePermission("products"), asyncHandler(productsController.updateVariations));
router.put("/:productId/add-ons", requirePermission("products"), asyncHandler(productsController.updateAddons));

export default router;
