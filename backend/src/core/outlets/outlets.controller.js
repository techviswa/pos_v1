import { apiResponse, sendRawResponse } from "../../shared/utils/apiResponse.js";
import { sendSyncOrRaw } from "../sync/sync-contract.js";
import { outletsService } from "./outlets.service.js";

class OutletsController {
  async list(req, res) {
    const data = await outletsService.listOutlets({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });
    sendSyncOrRaw(req, res, {
      resource: "outlets",
      data,
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });
  }

  async getById(req, res) {
    const data = await outletsService.getOutletById({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
    });
    res.status(200).json(apiResponse({ message: "Outlet fetched successfully", data }));
  }

  async create(req, res) {
    const data = await outletsService.createOutlet({
      tenantId: req.context.tenantId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Outlet created successfully", data }));
  }

  async update(req, res) {
    const data = await outletsService.updateOutlet({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Outlet updated successfully", data }));
  }

  async delete(req, res) {
    const data = await outletsService.deleteOutlet({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
    });
    res.status(200).json(apiResponse({ message: "Outlet deleted successfully", data }));
  }

  async assignUsers(req, res) {
    const data = await outletsService.assignUsers({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
      userIds: req.body?.assigned_user_ids || [],
    });
    res.status(200).json(apiResponse({ message: "Outlet user assignments updated successfully", data }));
  }

  async listStaff(req, res) {
    const data = await outletsService.listOutletStaff({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
    });
    sendRawResponse(res, { data });
  }

  async listProducts(req, res) {
    const data = await outletsService.listOutletProducts({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
    });
    sendRawResponse(res, { data });
  }

  async updateProducts(req, res) {
    const data = await outletsService.updateOutletProducts({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
      items: req.body?.items || req.body || [],
    });
    res.status(200).json(apiResponse({ message: "Outlet products updated successfully", data }));
  }

  async listInventory(req, res) {
    const data = await outletsService.listOutletInventory({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
    });
    sendRawResponse(res, { data });
  }

  async updateInventory(req, res) {
    const data = await outletsService.updateOutletInventory({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
      items: req.body?.items || req.body || [],
    });
    res.status(200).json(apiResponse({ message: "Outlet inventory updated successfully", data }));
  }

  async listFeatures(req, res) {
    const data = await outletsService.listOutletFeatures({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
    });
    sendRawResponse(res, { data });
  }

  async updateFeatures(req, res) {
    const data = await outletsService.updateOutletFeatures({
      tenantId: req.context.tenantId,
      outletId: req.params.outletId,
      items: req.body?.items || req.body || [],
    });
    res.status(200).json(apiResponse({ message: "Outlet features updated successfully", data }));
  }
}

export const outletsController = new OutletsController();
