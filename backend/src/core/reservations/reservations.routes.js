import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { reservationsController } from "./reservations.controller.js";

const router = Router();

router.get("/", asyncHandler(reservationsController.list));

export default router;
