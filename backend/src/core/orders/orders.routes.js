import { Router } from "express";

import { requireAnyPermission, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { ordersController } from "./orders.controller.js";
import { applyDefaultOutlet, orderOutletGuard } from "../../shared/middleware/recordOutletGuards.js";

const router = Router();
router.param("orderId", orderOutletGuard);

router.get("/", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.list));
router.get("/:orderId", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.getById));
router.post("/", requireAnyPermission("billing", "bills"), applyDefaultOutlet, asyncHandler(ordersController.create));
router.put("/:orderId", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.update));
router.delete("/:orderId", requireRole("Owner", "Manager"), asyncHandler(ordersController.delete));

export default router;
