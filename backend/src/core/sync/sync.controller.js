import { apiResponse } from "../../shared/utils/apiResponse.js";
import { syncService } from "./sync.service.js";

class SyncController {
  async strategy(_req, res) {
    res.status(200).json(apiResponse({ message: "Offline sync strategy fetched successfully", data: syncService.getStrategy() }));
  }

  async listEvents(req, res) {
    const data = await syncService.listClientEvents({
      tenantId: req.context.tenantId,
      status: req.query?.status,
    });
    res.status(200).json(apiResponse({ message: "Client sync events fetched successfully", data }));
  }

  async recordEvent(req, res) {
    const data = await syncService.recordClientEvent({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      user: req.user,
      payload: req.body || {},
    });
    res.status(202).json(apiResponse({ message: "Client sync event accepted successfully", data }));
  }

  async exportResource(req, res) {
    const data = await syncService.exportResource({
      resource: req.params.resource,
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      query: req.query || {},
    });
    res.status(200).json(data);
  }

  async listAdminCoreLogs(req, res) {
    const data = await syncService.listAdminCoreLogs({
      tenantId: req.context.tenantId,
      resource: req.query?.resource,
      status: req.query?.status,
    });
    res.status(200).json(apiResponse({ message: "AdminCore sync logs fetched successfully", data }));
  }

  async recordAdminCoreLog(req, res) {
    const data = await syncService.recordAdminCoreLog({
      ...req.body,
      tenant_id: req.body?.tenant_id || req.context.tenantId,
      business_id: req.body?.business_id || req.context.businessId,
    });
    res.status(202).json(apiResponse({ message: "AdminCore sync log recorded successfully", data }));
  }
}

export const syncController = new SyncController();
