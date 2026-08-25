import { apiResponse } from "../../shared/utils/apiResponse.js";
import { sendSyncOrRaw } from "../sync/sync-contract.js";
import { businessesService } from "./businesses.service.js";

class BusinessesController {
  async create(req, res) {
    const data = await businessesService.upsertBusiness({ payload: req.body });
    res.status(201).json(apiResponse({ message: "Business provisioned successfully", data }));
  }

  async update(req, res) {
    const data = await businessesService.upsertBusiness({ payload: { ...req.body, id: req.params.businessId } });
    res.status(200).json(apiResponse({ message: "Business updated successfully", data }));
  }
  async list(req, res) {
    const data = await businessesService.listBusinesses({ businessId: req.context.businessId });
    sendSyncOrRaw(req, res, {
      resource: "businesses",
      data,
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });
  }

  async getById(req, res) {
    const data = await businessesService.getBusinessById({ businessId: req.params.businessId, currentBusinessId: req.context.businessId });
    res.status(200).json(apiResponse({ message: "Business fetched successfully", data }));
  }
}

export const businessesController = new BusinessesController();


