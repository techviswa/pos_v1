import { Router } from "express";

import { requireAnyPermission, requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { inventoryController } from "./inventory.controller.js";

const router = Router();

router.get("/", requireAnyPermission("inventory", "reports"), asyncHandler(inventoryController.list));
router.get("/reports/cogs", requireAnyPermission("inventory", "reports"), asyncHandler(inventoryController.cogsReport));
router.get("/purchase-suggestions", requireAnyPermission("inventory", "reports"), asyncHandler(inventoryController.purchaseSuggestions));
router.post("/purchase-receivings", requirePermission("inventory"), asyncHandler(inventoryController.receivePurchase));
router.post("/vendor-bills", requirePermission("inventory"), asyncHandler(inventoryController.createVendorBill));
router.post("/stock-audits", requirePermission("inventory"), asyncHandler(inventoryController.createStockAudit));
router.post("/transfers", requirePermission("inventory"), asyncHandler(inventoryController.createTransferRequest));
router.post("/transfers/:allocationId/approve", requirePermission("inventory"), asyncHandler(inventoryController.approveTransfer));
router.post("/transfers/:allocationId/receive", requirePermission("inventory"), asyncHandler(inventoryController.receiveTransfer));
router.get("/:itemId", requireAnyPermission("inventory", "reports"), asyncHandler(inventoryController.getById));
router.post("/:itemId/wastage", requirePermission("inventory"), asyncHandler(inventoryController.recordWastage));
router.post("/", requirePermission("inventory"), asyncHandler(inventoryController.create));
router.put("/:itemId", requirePermission("inventory"), asyncHandler(inventoryController.update));
router.delete("/:itemId", requirePermission("inventory"), asyncHandler(inventoryController.delete));

export default router;
