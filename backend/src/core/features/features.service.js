import env from "../../config/env.js";
import { featureToggleService } from "../../services/featureToggleService.js";

class FeaturesService {
  async listFeatures({ businessId }) {
    return {
      business_id: businessId || env.defaultBusinessId,
      items: await featureToggleService.getBusinessFeatureState(businessId),
    };
  }

  async updateFeatures({ businessId, featureKeys }) {
    await featureToggleService.setFeaturesForBusiness(businessId, featureKeys);
    return this.listFeatures({ businessId });
  }

  async enableFeature({ businessId, featureKey }) {
    await featureToggleService.enableFeatureForBusiness(businessId, featureKey);
    return this.listFeatures({ businessId });
  }

  async disableFeature({ businessId, featureKey }) {
    await featureToggleService.disableFeatureForBusiness(businessId, featureKey);
    return this.listFeatures({ businessId });
  }
}

export const featuresService = new FeaturesService();
