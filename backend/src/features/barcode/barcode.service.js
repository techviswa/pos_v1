import { barcodeItems } from "../../shared/data/feature-mock-data.js";

class BarcodeService {
  async listBarcodes({ tenantId }) {
    return {
      tenantId,
      items: barcodeItems,
    };
  }

  async generateBarcode({ tenantId, payload }) {
    return {
      id: "barcode_new",
      tenantId,
      ...payload,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const barcodeService = new BarcodeService();
