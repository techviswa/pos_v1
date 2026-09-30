import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { hasEffectivePermission, requireAnyPermission, requireAuth } from "../../../shared/middleware/authGuard.middleware.js";
import { requireSaasLimit } from "../../../shared/middleware/saasLimit.middleware.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { tableManagementController } from "./table-management.controller.js";

// Floor layout, QR codes and table settings belong to the QR & tables and Reservations screens.
const FLOOR_SCREENS = ["qr_management", "reservations"];
const manage = requireAnyPermission(...FLOOR_SCREENS);
const deleteReservation = requireAnyPermission("reservations", "manager_view");

// Floor staff may flip a table's status; anything structural needs a floor screen.
const STAFF_TABLE_FIELDS = new Set(["status"]);
const limitStaffTableEdits = (req, res, next) => {
  if (hasEffectivePermission(req.user, ...FLOOR_SCREENS)) return next();
  const extra = Object.keys(req.body || {}).filter((key) => !STAFF_TABLE_FIELDS.has(key));
  if (extra.length) {
    return next(Object.assign(new Error(`You need the QR & tables or Reservations screen to change: ${extra.join(", ")}`), { statusCode: 403, code: "TABLE_EDIT_FORBIDDEN" }));
  }
  return next();
};

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.TABLE_MANAGEMENT,
  definitions: [
    { method: "get", path: "/settings", handler: tableManagementController.getSettings },
    { method: "put", path: "/settings", middleware: manage, handler: tableManagementController.updateSettings },
    { method: "get", path: "/areas", handler: tableManagementController.listAreas },
    { method: "post", path: "/areas", middleware: manage, handler: tableManagementController.createArea },
    { method: "put", path: "/areas/:areaId", middleware: manage, handler: tableManagementController.updateArea },
    { method: "delete", path: "/areas/:areaId", middleware: manage, handler: tableManagementController.deleteArea },
    { method: "get", path: "/reservations", handler: tableManagementController.listReservations },
    { method: "post", path: "/reservations", handler: tableManagementController.createReservation },
    { method: "post", path: "/reservations/:reservationId/confirm", handler: tableManagementController.confirmReservation },
    { method: "post", path: "/reservations/:reservationId/status", handler: tableManagementController.updateReservationStatus },
    { method: "post", path: "/reservations/:reservationId/undo", handler: tableManagementController.undoReservation },
    { method: "delete", path: "/reservations/:reservationId", middleware: deleteReservation, handler: tableManagementController.deleteReservation },
    {
      method: "post",
      path: "/:tableId/qr",
      middleware: [manage, requireSaasLimit("qr_tables")],
      handler: tableManagementController.upsertTableQrCode,
    },
    { method: "get", path: "/", handler: tableManagementController.listTables },
    { method: "post", path: "/", middleware: manage, handler: tableManagementController.createTable },
    { method: "put", path: "/:tableId", middleware: [requireAuth, limitStaffTableEdits], handler: tableManagementController.updateTable },
    { method: "delete", path: "/:tableId", middleware: manage, handler: tableManagementController.deleteTable },
  ],
});
