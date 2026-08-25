import { apiResponse } from "../../../shared/utils/apiResponse.js";
import { batchTrackingService } from "./batch-tracking.service.js";

class BatchTrackingController {
  async list(req, res) {
    const data = await batchTrackingService.listBatches({ tenantId: req.context.tenantId });
    res.status(200).json(apiResponse({ message: "Batches fetched successfully", data }));
  }

  async create(req, res) {
    const data = await batchTrackingService.createBatch({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Batch created successfully", data }));
  }
}

export const batchTrackingController = new BatchTrackingController();
