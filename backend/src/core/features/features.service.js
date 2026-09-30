import env from "../../config/env.js";
import { featureToggleService } from "../../services/featureToggleService.js";
import { saasService } from "../saas/saas.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";

class FeaturesService {
  // A tenant may switch features off or keep what it has, but cannot newly enable one its plan does not include.
  async assertWithinPlan(businessId, requestedKeys) {
    const [allowed, current] = await Promise.all([
      saasService.getPlanFeatures(businessId),
      featureToggleService.getEnabledFeaturesAsync(businessId),
    ]);
    const currentSet = new Set(current);
    const notIncluded = [...new Set(requestedKeys)].filter((key) => !currentSet.has(key) && !allowed.has(key));
    if (notIncluded.length) {
      throw createHttpError({
        statusCode: 403,
        code: "FEATURE_NOT_IN_PLAN",
        message: `Not included in your plan: ${notIncluded.join(", ")}`,
        details: { features: notIncluded },
      });
    }
  }

  async listFeatures({ businessId }) {
    return {
      business_id: businessId || env.defaultBusinessId,
      items: await featureToggleService.getBusinessFeatureState(businessId),
    };
  }

  async updateFeatures({ businessId, featureKeys }) {
    await this.assertWithinPlan(businessId, featureKeys || []);
    await featureToggleService.setFeaturesForBusiness(businessId, featureKeys);
    return this.listFeatures({ businessId });
  }

  async enableFeature({ businessId, featureKey }) {
    await this.assertWithinPlan(businessId, [featureKey]);
    await featureToggleService.enableFeatureForBusiness(businessId, featureKey);
    return this.listFeatures({ businessId });
  }

  async disableFeature({ businessId, featureKey }) {
    await featureToggleService.disableFeatureForBusiness(businessId, featureKey);
    return this.listFeatures({ businessId });
  }
}

export const featuresService = new FeaturesService();
