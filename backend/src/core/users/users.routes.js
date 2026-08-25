import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAuth, requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { requireSaasLimit } from "../../shared/middleware/saasLimit.middleware.js";
import { usersController } from "./users.controller.js";

const router = Router();

router.get("/metadata/access", requireAuth, asyncHandler(usersController.metadata));
router.get("/", requireRole("Owner", "Manager"), asyncHandler(usersController.list));
router.get("/:userId", requireRole("Owner", "Manager"), asyncHandler(usersController.getById));
router.post("/", requireRole("Owner", "Manager"), requireSaasLimit("staff"), asyncHandler(usersController.create));
router.put("/me/profile", requireAuth, asyncHandler(usersController.updateOwnProfile));
router.get("/:userId/activity", requireRole("Owner", "Manager"), asyncHandler(usersController.activity));
router.put("/:userId/permissions", requireRole("Owner", "Manager"), asyncHandler(usersController.permissions));
router.put("/:userId/outlets", requireRole("Owner", "Manager"), asyncHandler(usersController.assignOutlets));
router.put("/:userId", requireRole("Owner", "Manager"), asyncHandler(usersController.update));
router.delete("/:userId", requireRole("Owner", "Manager"), asyncHandler(usersController.delete));

export default router;
