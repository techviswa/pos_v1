import { Router } from "express";

import { requireAnyPermission, requirePermission, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { billingController } from "./billing.controller.js";

const router = Router();

router.get("/", requireAnyPermission("billing", "bills"), asyncHandler(billingController.list));
router.get("/summary", requireAnyPermission("billing", "bills", "reports"), asyncHandler(billingController.summary));
router.get("/sequences/next", requirePermission("billing"), asyncHandler(billingController.nextInvoice));
router.get("/shifts/current", requirePermission("billing"), asyncHandler(billingController.currentShift));
router.post("/shifts/open", requirePermission("billing"), asyncHandler(billingController.openShift));
router.post("/shifts/close", requirePermission("billing"), asyncHandler(billingController.closeShift));
router.get("/cash-drawer", requireAnyPermission("billing", "bills", "reports"), asyncHandler(billingController.cashDrawer));
router.get("/:invoiceId", requireAnyPermission("billing", "bills"), asyncHandler(billingController.getById));
router.get("/:invoiceId/gst-invoice", requireAnyPermission("billing", "bills"), asyncHandler(billingController.gstInvoice));
router.get("/:invoiceId/receipt-print", requireAnyPermission("billing", "bills"), asyncHandler(billingController.receiptPrint));
router.post("/", requirePermission("billing"), asyncHandler(billingController.create));
router.post("/:invoiceId/payments", requirePermission("billing"), asyncHandler(billingController.addPayment));
router.post("/:invoiceId/payments/:paymentId/confirm", requirePermission("billing"), asyncHandler(billingController.confirmPayment));
router.post("/:invoiceId/refunds", requirePermission("billing"), asyncHandler(billingController.refund));
router.post("/:invoiceId/void-request", requirePermission("billing"), asyncHandler(billingController.requestVoid));
router.post("/:invoiceId/void-approval", requireRole("Owner", "Manager"), asyncHandler(billingController.approveVoid));
router.put("/:invoiceId", requirePermission("billing"), asyncHandler(billingController.update));
router.delete("/:invoiceId", requirePermission("billing"), asyncHandler(billingController.delete));

export default router;
