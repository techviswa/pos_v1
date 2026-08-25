import { apiResponse } from "../../../shared/utils/apiResponse.js";
import { deliveryRoutePlanService } from "./delivery-route-plan.service.js";

class DeliveryRoutePlanController {
  async list(req, res) {
    const data = await deliveryRoutePlanService.listRoutePlans({ tenantId: req.context.tenantId });
    res.status(200).json(apiResponse({ message: "Delivery route plans fetched successfully", data }));
  }

  async getById(req, res) {
    const data = await deliveryRoutePlanService.getRoutePlanById({
      tenantId: req.context.tenantId,
      routePlanId: req.params.routePlanId,
    });
    res.status(200).json(apiResponse({ message: "Delivery route plan fetched successfully", data }));
  }

  async create(req, res) {
    const data = await deliveryRoutePlanService.createRoutePlan({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Delivery route plan created successfully", data }));
  }

  async update(req, res) {
    const data = await deliveryRoutePlanService.updateRoutePlan({
      tenantId: req.context.tenantId,
      routePlanId: req.params.routePlanId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Delivery route plan updated successfully", data }));
  }

  async start(req, res) {
    const data = await deliveryRoutePlanService.startRoutePlan({
      tenantId: req.context.tenantId,
      routePlanId: req.params.routePlanId,
    });
    res.status(200).json(apiResponse({ message: "Delivery route plan started successfully", data }));
  }

  async complete(req, res) {
    const data = await deliveryRoutePlanService.completeRoutePlan({
      tenantId: req.context.tenantId,
      routePlanId: req.params.routePlanId,
    });
    res.status(200).json(apiResponse({ message: "Delivery route plan completed successfully", data }));
  }
}

export const deliveryRoutePlanController = new DeliveryRoutePlanController();
