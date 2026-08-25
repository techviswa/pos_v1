import { apiResponse } from "../../shared/utils/apiResponse.js";
import { dashboardService } from "./dashboard.service.js";

class DashboardController {
  async stats(req, res) {
    const data = await dashboardService.getStats({ tenantId: req.context.tenantId });
    res.status(200).json(apiResponse({ message: "Dashboard stats fetched successfully", data }));
  }
}

export const dashboardController = new DashboardController();
