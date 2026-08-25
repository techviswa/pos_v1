import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { feedbackController } from "./feedback.controller.js";

const router = Router();

router.get("/", asyncHandler(feedbackController.list));
router.get("/form/:token", asyncHandler(feedbackController.form));
router.post("/form/:token", asyncHandler(feedbackController.submit));

export default router;
