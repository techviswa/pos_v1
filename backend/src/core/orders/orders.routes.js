import { Router } from "express";

import { requireAnyPermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { ordersController } from "./orders.controller.js";

const router = Router();

router.get("/", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.list));
router.get("/:orderId", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.getById));
router.post("/", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.create));
router.put("/:orderId", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.update));
router.delete("/:orderId", requireAnyPermission("billing", "bills"), asyncHandler(ordersController.delete));

export default router;
