import { apiResponse } from "../../shared/utils/apiResponse.js";
import { featuresService } from "./features.service.js";

class FeaturesController {
  async list(req, res) {
    const data = await featuresService.listFeatures({
      businessId: req.params.businessId || req.context?.businessId,
    });
    res.status(200).json(apiResponse({ message: "Feature configuration fetched successfully", data }));
  }

  async update(req, res) {
    const data = await featuresService.updateFeatures({
      businessId: req.params.businessId || req.context?.businessId,
      featureKeys: req.body?.feature_keys || [],
    });
    res.status(200).json(apiResponse({ message: "Feature configuration updated successfully", data }));
  }

  async enable(req, res) {
    const data = await featuresService.enableFeature({
      businessId: req.params.businessId || req.context?.businessId,
      featureKey: req.params.featureKey,
    });
    res.status(200).json(apiResponse({ message: "Feature enabled successfully", data }));
  }

  async disable(req, res) {
    const data = await featuresService.disableFeature({
      businessId: req.params.businessId || req.context?.businessId,
      featureKey: req.params.featureKey,
    });
    res.status(200).json(apiResponse({ message: "Feature disabled successfully", data }));
  }
}

export const featuresController = new FeaturesController();
