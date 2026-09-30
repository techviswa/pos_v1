import { Router } from "express";

import { apiResponse } from "../../shared/utils/apiResponse.js";
import { requireAnyPermission, requirePermission, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { customersController } from "./customers.controller.js";
import { customersService } from "./customers.service.js";
import { giftCardsService } from "./gift-cards.service.js";

const router = Router();
const scope = (req) => ({ businessId: req.context.businessId });
const send = (res, message, data, statusCode = 200) => res.status(statusCode).json(apiResponse({ message, data }));
const manageCustomers = requirePermission("customers");
const manageCards = requirePermission("gift_cards");
// The till looks customers and cards up while billing.
const atTill = requireAnyPermission("billing", "customers", "gift_cards");

// ---- /api/customers
router.get("/", requireAnyPermission("billing", "bills", "reports"), asyncHandler(customersController.list));
router.get("/lookup", atTill, asyncHandler(async (req, res) => send(res, "Customer", await customersService.lookup({ ...scope(req), phone: req.query.phone }))));
router.get("/profiles", manageCustomers, asyncHandler(async (req, res) => send(res, "Customers", await customersService.search({ ...scope(req), query: req.query }))));
router.get("/profiles/stats", manageCustomers, asyncHandler(async (req, res) => send(res, "Customer stats", await customersService.stats(scope(req)))));
router.get("/settings", atTill, asyncHandler(async (req, res) => send(res, "Loyalty and gift card settings", await customersService.getSettings(scope(req)))));
// Programme rules are a manager decision, like discounts.
router.put("/settings", requireRole("Owner", "Manager"), asyncHandler(async (req, res) => send(res, "Settings saved", await customersService.saveSettings({ ...scope(req), payload: req.body || {} }))));
router.post("/profiles", requireAnyPermission("customers", "billing"), asyncHandler(async (req, res) => send(res, "Customer added", await customersService.create({ ...scope(req), payload: req.body || {} }), 201)));
router.get("/profiles/:customerId", manageCustomers, asyncHandler(async (req, res) => send(res, "Customer", await customersService.get({ ...scope(req), customerId: req.params.customerId }))));
router.put("/profiles/:customerId", manageCustomers, asyncHandler(async (req, res) => send(res, "Customer saved", await customersService.update({ ...scope(req), customerId: req.params.customerId, payload: req.body || {} }))));
router.post("/profiles/:customerId/points", manageCustomers, asyncHandler(async (req, res) => send(res, "Points adjusted", await customersService.adjust({ ...scope(req), customerId: req.params.customerId, payload: req.body || {}, actor: req.user }))));
router.post("/profiles/:customerId/erase", requireRole("Owner", "Manager"), asyncHandler(async (req, res) => send(res, "Customer data erased", await customersService.anonymize({ ...scope(req), customerId: req.params.customerId, payload: req.body || {}, actor: req.user }))));

// ---- /api/customers/gift-cards
router.get("/gift-cards/lookup", atTill, asyncHandler(async (req, res) => send(res, "Gift card", await giftCardsService.lookup({ ...scope(req), code: req.query.code }))));
router.get("/gift-cards", manageCards, asyncHandler(async (req, res) => send(res, "Gift cards", await giftCardsService.list({ ...scope(req), query: req.query }))));
router.get("/gift-cards/summary", manageCards, asyncHandler(async (req, res) => send(res, "Gift card summary", await giftCardsService.summary(scope(req)))));
router.post("/gift-cards", manageCards, asyncHandler(async (req, res) => send(res, "Gift card sold", await giftCardsService.sell({ ...scope(req), actor: req.user, payload: req.body || {} }), 201)));
router.get("/gift-cards/:cardId", manageCards, asyncHandler(async (req, res) => send(res, "Gift card", await giftCardsService.get({ ...scope(req), cardId: req.params.cardId }))));
router.post("/gift-cards/:cardId/reload", manageCards, asyncHandler(async (req, res) => send(res, "Gift card topped up", await giftCardsService.reload({ ...scope(req), actor: req.user, cardId: req.params.cardId, payload: req.body || {} }))));
router.post("/gift-cards/:cardId/confirm-payment", manageCards, asyncHandler(async (req, res) => send(res, "Payment confirmed", await giftCardsService.confirmPayment({ ...scope(req), actor: req.user, cardId: req.params.cardId, payload: req.body || {} }))));
router.post("/gift-cards/:cardId/block", manageCards, asyncHandler(async (req, res) => send(res, "Gift card blocked", await giftCardsService.setBlocked({ ...scope(req), actor: req.user, cardId: req.params.cardId, blocked: true, reason: req.body?.reason }))));
router.post("/gift-cards/:cardId/unblock", manageCards, asyncHandler(async (req, res) => send(res, "Gift card unblocked", await giftCardsService.setBlocked({ ...scope(req), actor: req.user, cardId: req.params.cardId, blocked: false, reason: req.body?.reason }))));
router.post("/gift-cards/:cardId/void", manageCards, asyncHandler(async (req, res) => send(res, "Gift card voided", await giftCardsService.voidCard({ ...scope(req), actor: req.user, cardId: req.params.cardId, payload: req.body || {} }))));

export default router;
