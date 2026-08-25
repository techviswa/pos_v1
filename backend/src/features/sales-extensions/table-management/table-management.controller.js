import { apiResponse } from "../../../shared/utils/apiResponse.js";
import { isAdminCoreSyncRequest, createSyncEnvelope } from "../../../core/sync/sync-contract.js";
import { tableManagementService } from "./table-management.service.js";

class TableManagementController {
  async listTables(req, res) {
    const data = await tableManagementService.listTables({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });
    if (isAdminCoreSyncRequest(req)) {
      return res.status(200).json(
        createSyncEnvelope({
          resource: "tables",
          data: data.items || [],
          tenantId: req.context.tenantId,
          businessId: req.context.businessId,
        }),
      );
    }
    res.status(200).json(apiResponse({ message: "Tables fetched successfully", data }));
  }

  async createTable(req, res) {
    const data = await tableManagementService.createTable({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Table created successfully", data }));
  }

  async updateTable(req, res) {
    const data = await tableManagementService.updateTable({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      tableId: req.params.tableId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Table updated successfully", data }));
  }

  async deleteTable(req, res) {
    const data = await tableManagementService.deleteTable({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      tableId: req.params.tableId,
    });
    res.status(200).json(apiResponse({ message: "Table deleted successfully", data }));
  }

  async upsertTableQrCode(req, res) {
    const data = await tableManagementService.upsertTableQrCode({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      tableId: req.params.tableId,
      rotate: Boolean(req.body?.rotate),
      active: req.body?.active !== undefined ? Boolean(req.body.active) : true,
    });
    res.status(200).json(apiResponse({ message: "Table QR code updated successfully", data }));
  }

  async getSettings(req, res) {
    const data = await tableManagementService.getSettings({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });
    res.status(200).json(apiResponse({ message: "Table settings fetched successfully", data }));
  }

  async updateSettings(req, res) {
    const data = await tableManagementService.updateSettings({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Table settings updated successfully", data }));
  }

  async listAreas(req, res) {
    const data = await tableManagementService.listAreas({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
    });
    res.status(200).json(apiResponse({ message: "Table areas fetched successfully", data }));
  }

  async createArea(req, res) {
    const data = await tableManagementService.createArea({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Table area created successfully", data }));
  }

  async updateArea(req, res) {
    const data = await tableManagementService.updateArea({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      areaId: req.params.areaId,
      payload: req.body,
    });
    res.status(200).json(apiResponse({ message: "Table area updated successfully", data }));
  }

  async deleteArea(req, res) {
    const data = await tableManagementService.deleteArea({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      areaId: req.params.areaId,
    });
    res.status(200).json(apiResponse({ message: "Table area deleted successfully", data }));
  }

  async listReservations(req, res) {
    const data = await tableManagementService.listReservations({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      includeHistory: String(req.query.include_history || "").toLowerCase() === "true",
    });
    res.status(200).json(apiResponse({ message: "Table reservations fetched successfully", data }));
  }

  async createReservation(req, res) {
    const data = await tableManagementService.createReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Table reservation created successfully", data }));
  }

  async confirmReservation(req, res) {
    const data = await tableManagementService.confirmReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      reservationId: req.params.reservationId,
    });
    res.status(200).json(apiResponse({ message: "Reservation confirmed successfully", data }));
  }

  async undoReservation(req, res) {
    const data = await tableManagementService.undoReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      reservationId: req.params.reservationId,
    });
    res.status(200).json(apiResponse({ message: "Reservation released successfully", data }));
  }

  async updateReservationStatus(req, res) {
    const data = await tableManagementService.updateReservationStatus({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      reservationId: req.params.reservationId,
      status: req.body?.status,
    });
    res.status(200).json(apiResponse({ message: "Reservation status updated successfully", data }));
  }

  async deleteReservation(req, res) {
    const data = await tableManagementService.deleteReservation({
      tenantId: req.context.tenantId,
      businessId: req.context.businessId,
      reservationId: req.params.reservationId,
    });
    res.status(200).json(apiResponse({ message: "Reservation deleted successfully", data }));
  }
}

export const tableManagementController = new TableManagementController();
