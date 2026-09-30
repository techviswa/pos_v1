import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { feedbackController } from "./feedback.controller.js";

const router = Router();

router.get("/", requireRole("Owner", "Manager"), asyncHandler(feedbackController.list));
router.get("/form/:token", asyncHandler(feedbackController.form));
router.post("/form/:token", asyncHandler(feedbackController.submit));

export default router;
