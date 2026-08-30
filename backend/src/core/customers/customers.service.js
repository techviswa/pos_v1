import { syncService } from "../sync/sync.service.js";

class CustomersService {
  async listCustomers({ tenantId, businessId, query = {} }) {
    const data = await syncService.exportResource({
      resource: "customers",
      tenantId,
      businessId,
      query,
    });

    return {
      items: data.items,
      meta: data.meta,
    };
  }
}

export const customersService = new CustomersService();
