import { apiResponse } from "../../../shared/utils/apiResponse.js";
import { outletInventoryAllocationService } from "./outlet-inventory-allocation.service.js";

class OutletInventoryAllocationController {
  async list(req, res) {
    const data = await outletInventoryAllocationService.listAllocations({ tenantId: req.context.tenantId });
    res.status(200).json(apiResponse({ message: "Outlet allocations fetched successfully", data }));
  }

  async getById(req, res) {
    const data = await outletInventoryAllocationService.getAllocationById({
      tenantId: req.context.tenantId,
      allocationId: req.params.allocationId,
    });
    res.status(200).json(apiResponse({ message: "Outlet allocation fetched successfully", data }));
  }

  async create(req, res) {
    const data = await outletInventoryAllocationService.createAllocation({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Outlet allocation created successfully", data }));
  }

  async update(req, res) {
    const data = await outletInventoryAllocationService.updateAllocation({
      tenantId: req.context.tenantId,
      allocationId: req.params.allocationId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Outlet allocation updated successfully", data }));
  }

  async dispatch(req, res) {
    const data = await outletInventoryAllocationService.dispatchAllocation({
      tenantId: req.context.tenantId,
      allocationId: req.params.allocationId,
    });
    res.status(200).json(apiResponse({ message: "Outlet allocation dispatched successfully", data }));
  }

  async receive(req, res) {
    const data = await outletInventoryAllocationService.receiveAllocation({
      tenantId: req.context.tenantId,
      allocationId: req.params.allocationId,
    });
    res.status(200).json(apiResponse({ message: "Outlet allocation received successfully", data }));
  }
}

export const outletInventoryAllocationController = new OutletInventoryAllocationController();
