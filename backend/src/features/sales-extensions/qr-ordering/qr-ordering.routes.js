import { Router } from "express";

import { requireAnyPermission } from "../../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../../shared/utils/asyncHandler.js";
import { qrOrderingController } from "./qr-ordering.controller.js";

// The QR inbox appears on the Waiter, Manager and QR & tables screens.
const inbox = requireAnyPermission("waiter_view", "manager_view", "qr_management");

const router = Router();

router.get("/inbox", inbox, asyncHandler(qrOrderingController.inbox));
router.post("/orders/:orderId/approve", inbox, asyncHandler(qrOrderingController.approve));
router.post("/orders/:orderId/reject", inbox, asyncHandler(qrOrderingController.reject));
router.get("/orders/:trackingToken", asyncHandler(qrOrderingController.getOrder));
router.get("/:token", asyncHandler(qrOrderingController.getSession));
router.get("/:token/menu", asyncHandler(qrOrderingController.getMenu));
router.post("/:token/phone-verification", asyncHandler(qrOrderingController.requestPhoneVerification));
router.post("/:token/phone-verification/verify", asyncHandler(qrOrderingController.verifyPhone));
router.post("/:token/orders", asyncHandler(qrOrderingController.createOrder));

export default router;
