import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { requireRole } from "../../../shared/middleware/authGuard.middleware.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { kotController } from "./kot.controller.js";

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.KOT,
  definitions: [
    { method: "get", path: "/", handler: kotController.list },
    { method: "get", path: "/stations", handler: kotController.stations },
    { method: "post", path: "/", middleware: requireRole("Owner", "Manager", "Chef"), handler: kotController.create },
    { method: "get", path: "/:ticketId/history", handler: kotController.history },
    { method: "get", path: "/:ticketId/print", handler: kotController.print },
    {
      method: "put",
      path: "/:ticketId/status",
      middleware: requireRole("Owner", "Manager", "Chef"),
      handler: kotController.updateStatus,
    },
    {
      method: "post",
      path: "/:ticketId/accept",
      middleware: requireRole("Owner", "Manager", "Chef"),
      handler: kotController.accept,
    },
    {
      method: "post",
      path: "/:ticketId/reject",
      middleware: requireRole("Owner", "Manager", "Chef"),
      handler: kotController.reject,
    },
    {
      method: "post",
      path: "/:ticketId/start-prep",
      middleware: requireRole("Owner", "Manager", "Chef"),
      handler: kotController.startPrep,
    },
    {
      method: "post",
      path: "/:ticketId/ready",
      middleware: requireRole("Owner", "Manager", "Chef"),
      handler: kotController.ready,
    },
    {
      method: "post",
      path: "/:ticketId/complete-service",
      middleware: requireRole("Owner", "Manager", "Waiter"),
      handler: kotController.completeService,
    },
    {
      method: "put",
      path: "/:ticketId/items/:itemId/status",
      middleware: requireRole("Owner", "Manager", "Chef", "Waiter"),
      handler: kotController.updateItemStatus,
    },
  ],
});
