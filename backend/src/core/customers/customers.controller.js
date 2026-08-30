import { apiResponse } from "../../shared/utils/apiResponse.js";
import { isAdminCoreSyncRequest, createSyncEnvelope } from "../sync/sync-contract.js";
import { customersService } from "./customers.service.js";

class CustomersController {
  async list(req, res) {
    const data = await customersService.listCustomers({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      query: req.query || {},
    });

    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "customers",
          data: data.items,
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
        }),
      );
    }

    res.status(200).json(
      apiResponse({
        message: "Customers fetched successfully",
        data: data.items,
        meta: data.meta,
      }),
    );
  }
}

export const customersController = new CustomersController();
