import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { gatewayService } from "./gateway.service.js";

// ---- /api/public/payments/razorpay/webhook/:key
// Authenticated by the business's secret URL key plus the X-Razorpay-Signature over the raw body.
export const razorpayWebhookRouter = Router();
razorpayWebhookRouter.post("/webhook/:key", asyncHandler(async (req, res) => {
  const status = await gatewayService.receiveWebhook({
    key: req.params.key,
    rawBody: req.rawBody,
    signature: req.get("x-razorpay-signature"),
    eventId: req.get("x-razorpay-event-id"),
    body: req.body,
  });
  res.sendStatus(status);
}));
