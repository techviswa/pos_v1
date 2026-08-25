import { apiResponse, sendRawResponse } from "../../shared/utils/apiResponse.js";
import { saasService } from "./saas.service.js";

class SaasController {
  async listPlans(_req, res) {
    sendRawResponse(res, { data: await saasService.listPlans() });
  }

  async currentTenant(req, res) {
    const data = await saasService.getTenantOverview({ businessId: req.context.businessId });
    res.status(200).json(apiResponse({ message: "SaaS tenant fetched successfully", data }));
  }

  async getTenant(req, res) {
    sendRawResponse(res, { data: await saasService.getTenantOverview({ businessId: req.params.businessId }) });
  }

  async usage(req, res) {
    sendRawResponse(res, { data: await saasService.getUsage({ businessId: req.params.businessId || req.context.businessId }) });
  }
}

export const saasController = new SaasController();

