import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { requireAnyPermission } from "../../../shared/middleware/authGuard.middleware.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { kotController } from "./kot.controller.js";
import { ticketOutletGuard } from "../../../shared/middleware/recordOutletGuards.js";

// Kitchen work belongs to the Kitchen screen, serving to the Waiter screen; the Manager screen oversees both.
const kitchen = requireAnyPermission("kitchen_view", "manager_view");
const service = requireAnyPermission("waiter_view", "manager_view");
const anyFloor = requireAnyPermission("kitchen_view", "waiter_view", "manager_view");

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.KOT,
  params: { ticketId: ticketOutletGuard },
  definitions: [
    { method: "get", path: "/", handler: kotController.list },
    { method: "get", path: "/stations", handler: kotController.stations },
    { method: "post", path: "/", middleware: kitchen, handler: kotController.create },
    { method: "get", path: "/:ticketId/history", handler: kotController.history },
    { method: "get", path: "/:ticketId/print", handler: kotController.print },
    {
      method: "put",
      path: "/:ticketId/status",
      middleware: kitchen,
      handler: kotController.updateStatus,
    },
    {
      method: "post",
      path: "/:ticketId/accept",
      middleware: kitchen,
      handler: kotController.accept,
    },
    {
      method: "post",
      path: "/:ticketId/reject",
      middleware: kitchen,
      handler: kotController.reject,
    },
    {
      method: "post",
      path: "/:ticketId/start-prep",
      middleware: kitchen,
      handler: kotController.startPrep,
    },
    {
      method: "post",
      path: "/:ticketId/ready",
      middleware: kitchen,
      handler: kotController.ready,
    },
    {
      method: "post",
      path: "/:ticketId/complete-service",
      middleware: service,
      handler: kotController.completeService,
    },
    {
      method: "put",
      path: "/:ticketId/items/:itemId/status",
      middleware: anyFloor,
      handler: kotController.updateItemStatus,
    },
  ],
});
