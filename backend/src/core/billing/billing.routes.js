import { Router } from "express";

import { requireAnyPermission, requirePermission, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { billingController } from "./billing.controller.js";
import { getFulfillmentPolicy } from "./fulfillment-policy.js";
import { outletsService } from "../outlets/outlets.service.js";
import { assertOutletAllowed } from "../../shared/middleware/outletScope.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { applyDefaultOutlet, invoiceOutletGuard } from "../../shared/middleware/recordOutletGuards.js";

const router = Router();
router.param("invoiceId", invoiceOutletGuard);

router.get("/", requireAnyPermission("billing", "bills"), asyncHandler(billingController.list));
router.get("/ingredient-stock", requirePermission("billing"), asyncHandler(async (req, res) => {
  const outletId = req.query.outlet_id;
  if (typeof outletId !== "string" || !outletId) throw createHttpError({ statusCode: 400, message: "Select an outlet" });
  assertOutletAllowed(req, outletId);
  const rows = await outletsService.listOutletInventory({ tenantId: req.context.tenantId, outletId });
  res.set("Cache-Control", "private, no-store");
  res.json({ success: true, data: rows.map(row => ({ id: row.inventory_id, name: row.inventory_name, unit: row.unit,
    current_stock: row.enabled && !String(row.id).startsWith("virtual_") ? row.stock : row.central_stock })) });
}));
router.get("/fulfillment-modes", requirePermission("billing"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getFulfillmentPolicy(req.context.businessId || req.user.businessId || req.user.business_id) });
}));
router.get("/summary", requireAnyPermission("billing", "bills", "reports"), asyncHandler(billingController.summary));
router.get("/sequences/next", requirePermission("billing"), asyncHandler(billingController.nextInvoice));
router.get("/shifts/current", requireRole("Owner", "Manager", "Cashier"), requirePermission("billing"), asyncHandler(billingController.currentShift));
router.get("/shifts/history", requireRole("Owner", "Manager", "Cashier"), requireAnyPermission("billing", "reports"), asyncHandler(billingController.shiftHistory));
router.post("/shifts/open", requireRole("Owner", "Manager", "Cashier"), requirePermission("billing"), asyncHandler(billingController.openShift));
router.post("/shifts/close", requireRole("Owner", "Manager", "Cashier"), requirePermission("billing"), asyncHandler(billingController.closeShift));
router.get("/cash-drawer", requireRole("Owner", "Manager", "Cashier"), requireAnyPermission("billing", "bills", "reports"), asyncHandler(billingController.cashDrawer));
router.get("/:invoiceId", requireAnyPermission("billing", "bills"), asyncHandler(billingController.getById));
router.get("/:invoiceId/gst-invoice", requireAnyPermission("billing", "bills"), asyncHandler(billingController.gstInvoice));
router.get("/:invoiceId/receipt-print", requireAnyPermission("billing", "bills"), asyncHandler(billingController.receiptPrint));
router.post("/", requirePermission("billing"), applyDefaultOutlet, asyncHandler(billingController.create));
router.post("/:invoiceId/payments", requirePermission("billing"), asyncHandler(billingController.addPayment));
router.post("/:invoiceId/payments/:paymentId/confirm", requirePermission("billing"), asyncHandler(billingController.confirmPayment));
router.post("/:invoiceId/refunds", requireRole("Owner", "Manager"), asyncHandler(billingController.refund));
router.post("/:invoiceId/stock-reversal", requireRole("Owner", "Manager"), asyncHandler(billingController.reverseStock));
router.post("/:invoiceId/void-request", requirePermission("billing"), asyncHandler(billingController.requestVoid));
router.post("/:invoiceId/void-approval", requireRole("Owner", "Manager"), asyncHandler(billingController.approveVoid));
router.put("/:invoiceId", requirePermission("billing"), asyncHandler(billingController.update));
router.delete("/:invoiceId", requirePermission("billing"), asyncHandler(billingController.delete));

export default router;
