import { apiResponse, sendRawResponse } from "../../shared/utils/apiResponse.js";
import { sendSyncOrRaw } from "../sync/sync-contract.js";
import { usersService } from "./users.service.js";

class UsersController {
  async metadata(_req, res) {
    const data = await usersService.getAccessMetadata();
    res.status(200).json(apiResponse({ message: "User access metadata fetched successfully", data }));
  }

  async list(req, res) {
    const data = await usersService.listUsers({ tenantId: req.context.tenantId, businessId: req.context.businessId });
    sendSyncOrRaw(req, res, {
      resource: "staff",
      data,
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });
  }

  async getById(req, res) {
    const data = await usersService.getUserById({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      userId: req.params.userId,
    });
    res.status(200).json(apiResponse({ message: "User fetched successfully", data }));
  }

  async create(req, res) {
    const data = await usersService.createUser({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "User created successfully", data }));
  }

  async update(req, res) {
    const data = await usersService.updateUser({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      userId: req.params.userId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "User updated successfully", data }));
  }

  async delete(req, res) {
    const data = await usersService.deleteUser({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      userId: req.params.userId,
    });
    res.status(200).json(apiResponse({ message: "User deleted successfully", data }));
  }

  async updateOwnProfile(req, res) {
    const data = await usersService.updateOwnProfile({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      userId: req.user?.id,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Profile updated successfully", data }));
  }

  async activity(req, res) {
    const data = await usersService.getUserActivity({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      userId: req.params.userId,
    });
    res.status(200).json(apiResponse({ message: "User activity fetched successfully", data }));
  }

  async permissions(req, res) {
    const data = await usersService.updateUserPermissions({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      userId: req.params.userId,
      permissions: req.body?.permissions || [],
    });
    res.status(200).json(apiResponse({ message: "User permissions updated successfully", data }));
  }

  async assignOutlets(req, res) {
    const data = await usersService.assignUserOutlets({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      userId: req.params.userId,
      outletIds: req.body?.assigned_outlet_ids || [],
    });
    res.status(200).json(apiResponse({ message: "User outlet assignments updated successfully", data }));
  }
}

export const usersController = new UsersController();

