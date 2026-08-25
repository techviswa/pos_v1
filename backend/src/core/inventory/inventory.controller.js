import { apiResponse } from "../../shared/utils/apiResponse.js";
import { isAdminCoreSyncRequest, createSyncEnvelope } from "../sync/sync-contract.js";
import { inventoryService } from "./inventory.service.js";
import { inventoryOperationsService } from "./inventory-operations.service.js";

class InventoryController {
  async list(req, res) {
    const data = await inventoryService.listItems({ tenantId: req.context.tenantId, query: req.query });
    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "inventory",
          data,
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
          outletId: req.query.outlet_id || req.query.outletId || null,
        }),
      );
    }
    res.status(200).json(apiResponse({ message: "Inventory fetched successfully", data }));
  }

  async getById(req, res) {
    const data = await inventoryService.getItemById({
      tenantId: req.context.tenantId,
      itemId: req.params.itemId,
    });
    res.status(200).json(apiResponse({ message: "Inventory item fetched successfully", data }));
  }

  async create(req, res) {
    const data = await inventoryService.createItem({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Inventory item created successfully", data }));
  }

  async update(req, res) {
    const data = await inventoryService.updateItem({
      tenantId: req.context.tenantId,
      itemId: req.params.itemId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Inventory item updated successfully", data }));
  }

  async delete(req, res) {
    const data = await inventoryService.deleteItem({
      tenantId: req.context.tenantId,
      itemId: req.params.itemId,
    });
    res.status(200).json(apiResponse({ message: "Inventory item deleted successfully", data }));
  }

  async receivePurchase(req, res) {
    const data = await inventoryOperationsService.receivePurchase({
      tenantId: req.context.tenantId,
      payload: req.body,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Purchase received successfully", data }));
  }

  async createVendorBill(req, res) {
    const data = await inventoryOperationsService.createVendorBill({
      tenantId: req.context.tenantId,
      payload: req.body,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Vendor bill recorded successfully", data }));
  }

  async recordWastage(req, res) {
    const data = await inventoryOperationsService.recordWastage({
      tenantId: req.context.tenantId,
      itemId: req.params.itemId,
      payload: req.body,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Wastage recorded successfully", data }));
  }

  async createTransferRequest(req, res) {
    const data = await inventoryOperationsService.createTransferRequest({
      tenantId: req.context.tenantId,
      payload: req.body,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Stock transfer requested successfully", data }));
  }

  async approveTransfer(req, res) {
    const data = await inventoryOperationsService.approveTransfer({
      tenantId: req.context.tenantId,
      allocationId: req.params.allocationId,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Stock transfer approved successfully", data }));
  }

  async receiveTransfer(req, res) {
    const data = await inventoryOperationsService.receiveTransfer({
      tenantId: req.context.tenantId,
      allocationId: req.params.allocationId,
      user: req.user,
    });
    res.status(200).json(apiResponse({ message: "Stock transfer received successfully", data }));
  }

  async createStockAudit(req, res) {
    const data = await inventoryOperationsService.createStockAudit({
      tenantId: req.context.tenantId,
      payload: req.body,
      user: req.user,
    });
    res.status(201).json(apiResponse({ message: "Stock audit completed successfully", data }));
  }

  async cogsReport(req, res) {
    const data = await inventoryOperationsService.getCogsReport({
      tenantId: req.context.tenantId,
    });
    res.status(200).json(apiResponse({ message: "COGS report fetched successfully", data }));
  }

  async purchaseSuggestions(req, res) {
    const data = await inventoryOperationsService.getLowStockSuggestions({
      tenantId: req.context.tenantId,
    });
    res.status(200).json(apiResponse({ message: "Low-stock purchase suggestions fetched successfully", data }));
  }
}

export const inventoryController = new InventoryController();
