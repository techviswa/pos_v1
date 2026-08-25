import { Router } from "express";

import { requireRole } from "../../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../../shared/utils/asyncHandler.js";
import { qrOrderingController } from "./qr-ordering.controller.js";

const router = Router();

router.get("/inbox", requireRole("Owner", "Manager", "Waiter"), asyncHandler(qrOrderingController.inbox));
router.post("/orders/:orderId/approve", requireRole("Owner", "Manager", "Waiter"), asyncHandler(qrOrderingController.approve));
router.post("/orders/:orderId/reject", requireRole("Owner", "Manager", "Waiter"), asyncHandler(qrOrderingController.reject));
router.get("/orders/:trackingToken", asyncHandler(qrOrderingController.getOrder));
router.get("/:token", asyncHandler(qrOrderingController.getSession));
router.get("/:token/menu", asyncHandler(qrOrderingController.getMenu));
router.post("/:token/phone-verification", asyncHandler(qrOrderingController.requestPhoneVerification));
router.post("/:token/phone-verification/verify", asyncHandler(qrOrderingController.verifyPhone));
router.post("/:token/orders", asyncHandler(qrOrderingController.createOrder));

export default router;
