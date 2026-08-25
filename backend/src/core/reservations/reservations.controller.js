import { apiResponse } from "../../shared/utils/apiResponse.js";
import { createSyncEnvelope, isAdminCoreSyncRequest } from "../sync/sync-contract.js";
import { tableManagementService } from "../../features/sales-extensions/table-management/table-management.service.js";

class ReservationsController {
  async list(req, res) {
    const includeHistory = String(req.query?.include_history || req.query?.includeHistory || "").toLowerCase() === "true";
    const data = await tableManagementService.listReservations({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      includeHistory: includeHistory || isAdminCoreSyncRequest(req),
    });

    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "reservations",
          data: data.items || [],
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
        }),
      );
    }

    return res.status(200).json(apiResponse({ message: "Reservations fetched successfully", data }));
  }
}

export const reservationsController = new ReservationsController();
