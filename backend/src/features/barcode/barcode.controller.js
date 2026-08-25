import { apiResponse } from "../../shared/utils/apiResponse.js";
import { barcodeService } from "./barcode.service.js";

class BarcodeController {
  async list(req, res) {
    const data = await barcodeService.listBarcodes({ tenantId: req.context.tenantId });
    res.status(200).json(apiResponse({ message: "Barcodes fetched successfully", data }));
  }

  async generate(req, res) {
    const data = await barcodeService.generateBarcode({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Barcode generated successfully", data }));
  }
}

export const barcodeController = new BarcodeController();
