import { apiResponse } from "../../shared/utils/apiResponse.js";
import { dashboardService } from "./dashboard.service.js";
import { assertOutletAllowed } from '../../shared/middleware/outletScope.js';

class DashboardController {
  async stats(req, res) {
    const outletId = req.query?.outlet_id || req.query?.outletId || null;
    if (outletId) assertOutletAllowed(req, outletId);
    const data = await dashboardService.getStats({ tenantId: req.context.tenantId, outletId });
    res.status(200).json(apiResponse({ message: "Dashboard stats fetched successfully", data }));
  }
}

export const dashboardController = new DashboardController();
