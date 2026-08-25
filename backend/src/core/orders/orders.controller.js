import { apiResponse } from "../../shared/utils/apiResponse.js";
import { isAdminCoreSyncRequest, createSyncEnvelope } from "../sync/sync-contract.js";
import { ordersService } from "./orders.service.js";

class OrdersController {
  async list(req, res) {
    const data = await ordersService.listOrders({ tenantId: req.context.tenantId, query: req.query });
    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "orders",
          data,
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
          outletId: req.query.outlet_id || req.query.outletId || null,
        }),
      );
    }
    res.status(200).json(apiResponse({ message: "Orders fetched successfully", data }));
  }

  async getById(req, res) {
    const data = await ordersService.getOrderById({
      tenantId: req.context.tenantId,
      orderId: req.params.orderId,
    });
    res.status(200).json(apiResponse({ message: "Order fetched successfully", data }));
  }

  async create(req, res) {
    const data = await ordersService.createOrder({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Order created successfully", data }));
  }

  async update(req, res) {
    const data = await ordersService.updateOrder({
      tenantId: req.context.tenantId,
      orderId: req.params.orderId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Order updated successfully", data }));
  }

  async delete(req, res) {
    const data = await ordersService.deleteOrder({
      tenantId: req.context.tenantId,
      orderId: req.params.orderId,
    });
    res.status(200).json(apiResponse({ message: "Order deleted successfully", data }));
  }
}

export const ordersController = new OrdersController();
