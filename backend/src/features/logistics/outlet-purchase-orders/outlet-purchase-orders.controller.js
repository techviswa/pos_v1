import { apiResponse } from "../../../shared/utils/apiResponse.js";
import { outletPurchaseOrdersService } from "./outlet-purchase-orders.service.js";

class OutletPurchaseOrdersController {
  async list(req, res) {
    const data = await outletPurchaseOrdersService.listPurchaseOrders({ tenantId: req.context.tenantId });
    res.status(200).json(apiResponse({ message: "Outlet purchase orders fetched successfully", data }));
  }

  async getById(req, res) {
    const data = await outletPurchaseOrdersService.getPurchaseOrderById({
      tenantId: req.context.tenantId,
      purchaseOrderId: req.params.purchaseOrderId,
    });
    res.status(200).json(apiResponse({ message: "Outlet purchase order fetched successfully", data }));
  }

  async create(req, res) {
    const data = await outletPurchaseOrdersService.createPurchaseOrder({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Outlet purchase order created successfully", data }));
  }

  async update(req, res) {
    const data = await outletPurchaseOrdersService.updatePurchaseOrder({
      tenantId: req.context.tenantId,
      purchaseOrderId: req.params.purchaseOrderId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Outlet purchase order updated successfully", data }));
  }

  async approve(req, res) {
    const data = await outletPurchaseOrdersService.approvePurchaseOrder({
      tenantId: req.context.tenantId,
      purchaseOrderId: req.params.purchaseOrderId,
    });
    res.status(200).json(apiResponse({ message: "Outlet purchase order approved successfully", data }));
  }

  async reject(req, res) {
    const data = await outletPurchaseOrdersService.rejectPurchaseOrder({
      tenantId: req.context.tenantId,
      purchaseOrderId: req.params.purchaseOrderId,
    });
    res.status(200).json(apiResponse({ message: "Outlet purchase order rejected successfully", data }));
  }
}

export const outletPurchaseOrdersController = new OutletPurchaseOrdersController();
