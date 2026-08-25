import { Router } from "express";

import { requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { reportsController } from "./reports.controller.js";

const router = Router();

router.use(requirePermission("reports"));

router.get("/", asyncHandler(reportsController.overview));
router.get("/sales-by-date", asyncHandler(reportsController.sales));
router.get("/gst", asyncHandler(reportsController.gst));
router.get("/tax", asyncHandler(reportsController.gst));
router.get("/profitability", asyncHandler(reportsController.profitability));
router.get("/hourly-sales", asyncHandler(reportsController.hourly));
router.get("/staff-performance", asyncHandler(reportsController.staff));
router.get("/outlet-comparison", asyncHandler(reportsController.outlets));
router.get("/customer-analytics", asyncHandler(reportsController.customers));
router.get("/exports/:reportKey", asyncHandler(reportsController.export));
router.get("/schedules", asyncHandler(reportsController.listSchedules));
router.post("/schedules", asyncHandler(reportsController.createSchedule));
router.post("/schedules/:scheduleId/run", asyncHandler(reportsController.runSchedule));

export default router;
