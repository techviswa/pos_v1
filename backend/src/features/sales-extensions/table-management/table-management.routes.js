import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { requireSaasLimit } from "../../../shared/middleware/saasLimit.middleware.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { tableManagementController } from "./table-management.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.TABLE_MANAGEMENT,
  definitions: [
    { method: "get", path: "/settings", handler: tableManagementController.getSettings },
    { method: "put", path: "/settings", handler: tableManagementController.updateSettings },
    { method: "get", path: "/areas", handler: tableManagementController.listAreas },
    { method: "post", path: "/areas", handler: tableManagementController.createArea },
    { method: "put", path: "/areas/:areaId", handler: tableManagementController.updateArea },
    { method: "delete", path: "/areas/:areaId", handler: tableManagementController.deleteArea },
    { method: "get", path: "/reservations", handler: tableManagementController.listReservations },
    { method: "post", path: "/reservations", handler: tableManagementController.createReservation },
    { method: "post", path: "/reservations/:reservationId/confirm", handler: tableManagementController.confirmReservation },
    { method: "post", path: "/reservations/:reservationId/status", handler: tableManagementController.updateReservationStatus },
    { method: "post", path: "/reservations/:reservationId/undo", handler: tableManagementController.undoReservation },
    { method: "delete", path: "/reservations/:reservationId", handler: tableManagementController.deleteReservation },
    {
      method: "post",
      path: "/:tableId/qr",
      middleware: requireSaasLimit("qr_tables"),
      handler: tableManagementController.upsertTableQrCode,
    },
    { method: "get", path: "/", handler: tableManagementController.listTables },
    { method: "post", path: "/", handler: tableManagementController.createTable },
    { method: "put", path: "/:tableId", handler: tableManagementController.updateTable },
    { method: "delete", path: "/:tableId", handler: tableManagementController.deleteTable },
  ],
});
