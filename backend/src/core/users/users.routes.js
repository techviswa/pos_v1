import { Router } from "express";

import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAuth, requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { requireSaasLimit } from "../../shared/middleware/saasLimit.middleware.js";
import { usersController } from "./users.controller.js";

const router = Router();

router.get("/metadata/access", requireAuth, asyncHandler(usersController.metadata));
router.get("/", requirePermission("staff"), asyncHandler(usersController.list));
router.get("/:userId", requirePermission("staff"), asyncHandler(usersController.getById));
router.post("/", requirePermission("staff"), requireSaasLimit("staff"), asyncHandler(usersController.create));
router.put("/me/profile", requireAuth, asyncHandler(usersController.updateOwnProfile));
router.get("/:userId/activity", requirePermission("staff"), asyncHandler(usersController.activity));
router.put("/:userId/permissions", requirePermission("staff"), asyncHandler(usersController.permissions));
router.put("/:userId/outlets", requirePermission("staff"), asyncHandler(usersController.assignOutlets));
router.put("/:userId", requirePermission("staff"), asyncHandler(usersController.update));
router.delete("/:userId", requirePermission("staff"), asyncHandler(usersController.delete));

export default router;
