import { apiResponse } from "../../shared/utils/apiResponse.js";
import { createSyncEnvelope, isAdminCoreSyncRequest } from "../sync/sync-contract.js";
import { tableManagementService } from "../../features/sales-extensions/table-management/table-management.service.js";

class TablesController {
  async list(req, res) {
    const data = await tableManagementService.listTables({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });

    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "tables",
          data: data.items || [],
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
        }),
      );
    }

    return res.status(200).json(apiResponse({ message: "Tables fetched successfully", data }));
  }
}

export const tablesController = new TablesController();
