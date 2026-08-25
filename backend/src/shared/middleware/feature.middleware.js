import { featureToggleService } from "../../services/featureToggleService.js";
import { createHttpError } from "../utils/http-error.js";

export const featureMiddleware = (featureName) => {
  return async (req, res, next) => {
    const businessId = req.context?.businessId || req.headers.business_id;

    if (!featureToggleService.isKnownFeature(featureName)) {
      return next(
        createHttpError({
          statusCode: 500,
          code: "FEATURE_NOT_REGISTERED",
          message: `Feature '${featureName}' is not registered in the feature toggle system`,
        }),
      );
    }

    const enabled = await featureToggleService.isFeatureEnabled(featureName, businessId);

    if (!enabled) {
      return next(
        createHttpError({
          statusCode: 403,
          code: "FEATURE_DISABLED",
          message: `Feature '${featureName}' is disabled for business '${businessId}'`,
          details: {
            business_id: businessId,
            feature: featureName,
          },
        }),
      );
    }

    return next();
  };
};
