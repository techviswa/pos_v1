import { apiResponse, sendRawResponse } from "../../shared/utils/apiResponse.js";
import { sendSyncOrRaw } from "../sync/sync-contract.js";
import { productsService } from "./products.service.js";

class ProductsController {
  async list(req, res) {
    const data = await productsService.listProducts({
      tenantId: req.context.tenantId,
      query: req.query,
    });
    sendSyncOrRaw(req, res, {
      resource: "products",
      data,
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      outletId: req.query.outlet_id || req.query.outletId || null,
    });
  }

  async catalog(req, res) {
    const data = await productsService.listCatalog({
      tenantId: req.context.tenantId,
      query: req.query,
    });
    sendRawResponse(res, { data });
  }

  async getById(req, res) {
    const data = await productsService.getProductById({
      tenantId: req.context.tenantId,
      productId: req.params.productId,
    });
    res.status(200).json(apiResponse({ message: "Product fetched successfully", data }));
  }

  async create(req, res) {
    const data = await productsService.createProduct({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Product created successfully", data }));
  }

  async update(req, res) {
    const data = await productsService.updateProduct({
      tenantId: req.context.tenantId,
      productId: req.params.productId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Product updated successfully", data }));
  }

  async delete(req, res) {
    const data = await productsService.deleteProduct({
      tenantId: req.context.tenantId,
      productId: req.params.productId,
    });
    res.status(200).json(apiResponse({ message: "Product deleted successfully", data }));
  }

  async stockAdjustment(req, res) {
    const data = await productsService.adjustProductStock({
      tenantId: req.context.tenantId,
      productId: req.params.productId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Product stock adjusted successfully", data }));
  }

  async updateVariations(req, res) {
    const data = await productsService.updateVariations({
      tenantId: req.context.tenantId,
      productId: req.params.productId,
      variations: req.body?.variation_options || req.body,
    });
    res.status(200).json(apiResponse({ message: "Product variations updated successfully", data }));
  }

  async updateAddons(req, res) {
    const data = await productsService.updateAddons({
      tenantId: req.context.tenantId,
      productId: req.params.productId,
      addons: req.body?.addon_options || req.body,
    });
    res.status(200).json(apiResponse({ message: "Product add-ons updated successfully", data }));
  }
}

export const productsController = new ProductsController();
