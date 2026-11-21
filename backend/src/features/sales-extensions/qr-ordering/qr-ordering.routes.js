import { Router } from "express";
import { Prisma } from "@prisma/client";

import { requireAnyPermission, requirePermission } from "../../../shared/middleware/authGuard.middleware.js";
import prisma from "../../../database/prisma/client.js";
import { qrCheckoutService } from "./qr-checkout.service.js";
import { orderOutletGuard } from "../../../shared/middleware/recordOutletGuards.js";
import { asyncHandler } from "../../../shared/utils/asyncHandler.js";
import { qrOrderingController } from "./qr-ordering.controller.js";
import { getQrConnection } from "./qr-connection.js";
import { serveProductImage } from "../../../core/products/product-images.js";
import { tableAssistanceService } from "./table-assistance.service.js";
import experienceRoutes from "./qr-experience.routes.js";
import { qrVisitBillingService } from "./qr-visit-billing.service.js";
import { ingredientAllergensService } from "../../../core/products/ingredient-allergens.js";

// The QR inbox appears on the Waiter, Manager and QR & tables screens.
const inbox = requireAnyPermission("waiter_view", "manager_view", "qr_management");

const router = Router();
router.use(experienceRoutes);
router.get("/allergens/ingredients", requirePermission("inventory"), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json({ success: true, data: await ingredientAllergensService.catalog(req.context) });
}));
router.put("/allergens/ingredients/:ingredientId", requirePermission("inventory"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await ingredientAllergensService.save({ ...req.context, ingredientId: req.params.ingredientId, payload: req.body, user: req.user }) });
}));
router.get("/checkout/:orderId/visit", requirePermission("billing"), asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json({ success: true, data: await qrVisitBillingService.preview({ ...req.context, orderId: req.params.orderId }) });
}));
router.post("/checkout/:orderId/visit", requirePermission("billing"), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qrVisitBillingService.issue({ ...req.context, orderId: req.params.orderId, user: req.user, payload: req.body }) });
}));
router.get("/checkout/inbox", requirePermission("billing"), asyncHandler(async (req, res) => {
  const paged = req.query.page !== undefined;
  const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
  const limit = 10;
  const outletIds = req.query.outlet_id ? [req.query.outlet_id] : req.context.outletScope;
  const items = await prisma.order.findMany({ where: {
    businessId: req.context.businessId, channel: "qr", bill: null,
    ...(outletIds ? { outletId: { in: outletIds } } : {}),
    AND: [{ metadata: { path: ["approval_status"], equals: "approved" } }, { metadata: { path: ["bill_requested"], equals: true } },
      { OR: [Prisma.DbNull, Prisma.JsonNull, []].map(value => ({ metadata: { path: ["qr_bill_ids"], equals: value } })) }],
    status: { notIn: ["cancelled", "rejected", "qr_rejected"] },
  }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: paged ? limit + 1 : 100, skip: paged ? (page - 1) * limit : 0, select: { id: true, customerName: true, total: true, metadata: true, createdAt: true } });
  res.set("Cache-Control", "private, no-store");
  const rows = (paged ? items.slice(0, limit) : items).filter((order) => !order.metadata?.qr_bill_ids?.length).map((order) => ({ id: order.id, customer_name: order.customerName, table: order.metadata?.table_name, total: order.total, created_at: order.createdAt, points_requested: order.metadata?.qr_loyalty_points || 0 }));
  res.json({ success: true, data: paged ? { items: rows, page, has_more: items.length > limit } : rows });
}));
router.post("/checkout/:orderId/issue", requirePermission("billing"), (req, res, next) => orderOutletGuard(req, res, next, req.params.orderId), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qrCheckoutService.issueBill({ ...req.context, orderId: req.params.orderId, user: req.user, applyPoints: req.body?.apply_points !== false }) });
}));
router.get("/orders/:trackingToken/checkout", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ success: true, data: await qrCheckoutService.snapshot({ ...req.params, billId: req.query.bill_id }) });
}));
router.post("/orders/:trackingToken/checkout/request", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qrCheckoutService.requestBill({ ...req.params, points: req.body?.points ?? 0, verificationToken: req.body?.verification_token }) });
}));
router.post("/orders/:trackingToken/checkout/pay", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qrCheckoutService.pay({ ...req.params, amount: req.body?.amount, requestId: req.body?.client_request_id, billId: req.body?.bill_id }) });
}));
router.post("/orders/:trackingToken/checkout/payments/:intentId/:action", asyncHandler(async (req, res) => {
  if (!["refresh", "cancel"].includes(req.params.action)) return res.status(404).json({ success: false });
  res.json({ success: true, data: await qrCheckoutService.paymentAction({ ...req.params, billId: req.body?.bill_id }) });
}));
router.post("/orders/:trackingToken/loyalty/code", asyncHandler(async (req, res) => {
  res.json({ success: true, data: await qrCheckoutService.sendCode(req.params) });
}));
router.post("/orders/:trackingToken/loyalty/verify", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ success: true, data: await qrCheckoutService.verifyCode({ ...req.params, verificationToken: req.body?.verification_token, otp: req.body?.otp }) });
}));
const assistance = requireAnyPermission("waiter_view", "manager_view");
const assistanceScope = (req) => ({ businessId: req.context.businessId,
  outletIds: req.query.outlet_id ? [req.query.outlet_id] : req.context.outletScope });
router.get("/assistance/inbox", assistance, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const scope = assistanceScope(req);
  res.json({ success: true, data: { items: await tableAssistanceService.list({ ...scope, history: req.query.history === "true" }), staff: await tableAssistanceService.staff(scope) } });
}));
router.post("/assistance/:id/:action", assistance, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await tableAssistanceService.update({ ...assistanceScope(req), id: req.params.id, action: req.params.action, assigneeId: req.body.assignee_id, user: req.user }) });
}));
router.get("/product-images/:businessId/:productId", asyncHandler(serveProductImage));
router.get("/connection", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(getQrConnection());
});

router.get("/inbox", inbox, asyncHandler(qrOrderingController.inbox));
router.post("/orders/:orderId/approve", inbox, asyncHandler(qrOrderingController.approve));
router.post("/orders/:orderId/reject", inbox, asyncHandler(qrOrderingController.reject));
router.get("/orders/:trackingToken", asyncHandler(qrOrderingController.getOrder));
router.get("/:token", asyncHandler(qrOrderingController.getSession));
router.get("/:token/menu", asyncHandler(qrOrderingController.getMenu));
router.get("/:token/assistance", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ success: true, data: await tableAssistanceService.guestList({ token: req.params.token, sessionKey: req.query.session_key }) });
}));
router.post("/:token/assistance", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const data = await tableAssistanceService.create({ token: req.params.token, sessionKey: req.body.session_key, payload: req.body });
  res.status(data.duplicate ? 200 : 201).json({ success: true, data });
}));
router.post("/:token/phone-verification", asyncHandler(qrOrderingController.requestPhoneVerification));
router.post("/:token/phone-verification/verify", asyncHandler(qrOrderingController.verifyPhone));
router.post("/:token/orders", asyncHandler(qrOrderingController.createOrder));

export default router;
