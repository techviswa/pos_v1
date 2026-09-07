import { readState, writeState } from "../../database/prisma/state-store.js";

export const saasStore = {
  async getBusinessConfig(businessId) {
    return readState(`saas:${businessId}`);
  },

  async saveBusinessConfig(businessId, config) {
    return writeState(`saas:${businessId}`, {
      ...config,
      business_id: businessId,
      updated_at: new Date().toISOString(),
    });
  },
};
