import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { tablesController } from "./tables.controller.js";

const router = Router();

router.get("/", asyncHandler(tablesController.list));

export default router;
