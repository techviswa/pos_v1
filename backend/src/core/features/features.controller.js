import { apiResponse } from "../../shared/utils/apiResponse.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { featuresService } from "./features.service.js";

// Feature flags are per business and are decided by the plan. A tenant may only address its own business.
const ownBusinessId = (req) => {
  const requested = req.params.businessId;
  if (requested && String(requested) !== String(req.context?.businessId)) {
    throw createHttpError({ statusCode: 403, message: "Forbidden: business access denied" });
  }
  return req.context?.businessId;
};

class FeaturesController {
  async list(req, res) {
    const data = await featuresService.listFeatures({
      businessId: ownBusinessId(req),
    });
    res.status(200).json(apiResponse({ message: "Feature configuration fetched successfully", data }));
  }

  async update(req, res) {
    const data = await featuresService.updateFeatures({
      businessId: ownBusinessId(req),
      featureKeys: req.body?.feature_keys || [],
    });
    res.status(200).json(apiResponse({ message: "Feature configuration updated successfully", data }));
  }

  async enable(req, res) {
    const data = await featuresService.enableFeature({
      businessId: ownBusinessId(req),
      featureKey: req.params.featureKey,
    });
    res.status(200).json(apiResponse({ message: "Feature enabled successfully", data }));
  }

  async disable(req, res) {
    const data = await featuresService.disableFeature({
      businessId: ownBusinessId(req),
      featureKey: req.params.featureKey,
    });
    res.status(200).json(apiResponse({ message: "Feature disabled successfully", data }));
  }
}

export const featuresController = new FeaturesController();
