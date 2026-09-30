import { Router } from "express";

import { apiResponse } from "../../shared/utils/apiResponse.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { marketingService } from "./marketing.service.js";
import { receiveSmsInbound, receiveSmsStatus, receiveWhatsApp, verifyWhatsAppSubscription } from "./webhooks.js";

const scope = (req) => ({ businessId: req.context.businessId });
const send = (res, message, data, statusCode = 200) => res.status(statusCode).json(apiResponse({ message, data }));

// ---- /api/marketing (Marketing screen)
export const marketingRouter = Router();
marketingRouter.use(requirePermission("marketing"));
marketingRouter.get("/overview", asyncHandler(async (req, res) => send(res, "Marketing", await marketingService.overview(scope(req)))));
marketingRouter.get("/settings", asyncHandler(async (req, res) => send(res, "Marketing settings", await marketingService.getConfig(scope(req)))));
marketingRouter.put("/settings", asyncHandler(async (req, res) => send(res, "Marketing settings saved", await marketingService.saveConfig({ ...scope(req), payload: req.body || {} }))));
marketingRouter.get("/templates", asyncHandler(async (req, res) => send(res, "Templates", await marketingService.listTemplates(scope(req)))));
marketingRouter.post("/templates", asyncHandler(async (req, res) => send(res, "Template saved", await marketingService.createTemplate({ ...scope(req), payload: req.body || {} }), 201)));
marketingRouter.put("/templates/:templateId", asyncHandler(async (req, res) => send(res, "Template saved", await marketingService.updateTemplate({ ...scope(req), templateId: req.params.templateId, payload: req.body || {} }))));
marketingRouter.delete("/templates/:templateId", asyncHandler(async (req, res) => send(res, "Template deleted", await marketingService.deleteTemplate({ ...scope(req), templateId: req.params.templateId }))));
marketingRouter.post("/preview", asyncHandler(async (req, res) => send(res, "Preview", await marketingService.preview({ ...scope(req), payload: req.body || {} }))));
marketingRouter.post("/test", asyncHandler(async (req, res) => send(res, "Test message sent", await marketingService.testSend({ ...scope(req), payload: req.body || {} }))));
marketingRouter.get("/campaigns", asyncHandler(async (req, res) => send(res, "Campaigns", await marketingService.listCampaigns(scope(req)))));
marketingRouter.post("/campaigns", asyncHandler(async (req, res) => send(res, "Campaign created", await marketingService.createCampaign({ ...scope(req), actor: req.user, payload: req.body || {} }), 201)));
marketingRouter.get("/campaigns/:campaignId", asyncHandler(async (req, res) => send(res, "Campaign", await marketingService.report({ ...scope(req), campaignId: req.params.campaignId }))));
marketingRouter.post("/campaigns/:campaignId/schedule", asyncHandler(async (req, res) => send(res, "Campaign scheduled", await marketingService.schedule({ ...scope(req), campaignId: req.params.campaignId, payload: req.body || {} }))));
marketingRouter.post("/campaigns/:campaignId/cancel", asyncHandler(async (req, res) => send(res, "Campaign cancelled", await marketingService.cancel({ ...scope(req), campaignId: req.params.campaignId }))));
marketingRouter.post("/campaigns/:campaignId/automation", asyncHandler(async (req, res) => send(res, "Automation updated", await marketingService.setAutomation({ ...scope(req), campaignId: req.params.campaignId, payload: req.body || {} }))));

// ---- /api/public/marketing (provider callbacks; authenticated by signature or secret key)
export const marketingWebhookRouter = Router();
marketingWebhookRouter.get("/whatsapp/webhook", asyncHandler(async (req, res) => {
  const challenge = await verifyWhatsAppSubscription(req.query || {});
  if (challenge === null) return res.status(403).send("Forbidden");
  return res.status(200).type("text/plain").send(challenge);
}));
marketingWebhookRouter.post("/whatsapp/webhook", asyncHandler(async (req, res) => {
  const accepted = await receiveWhatsApp({ rawBody: req.rawBody, signature: req.get("x-hub-signature-256"), body: req.body });
  res.sendStatus(accepted ? 200 : 401);
}));
marketingWebhookRouter.post("/sms/status/:key", asyncHandler(async (req, res) => {
  res.sendStatus((await receiveSmsStatus({ key: req.params.key, body: req.body })) ? 200 : 404);
}));
marketingWebhookRouter.post("/sms/inbound/:key", asyncHandler(async (req, res) => {
  res.sendStatus((await receiveSmsInbound({ key: req.params.key, body: req.body })) ? 200 : 404);
}));
