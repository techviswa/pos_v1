import { Router } from "express";

import { requireRole } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { authController } from "./auth.controller.js";

const router = Router();

router.post("/login", asyncHandler(authController.login));
router.get("/me", asyncHandler(authController.me));
router.post("/refresh", asyncHandler(authController.refresh));
router.get("/session", asyncHandler(authController.session));
router.post("/logout", asyncHandler(authController.logout));
router.post("/forgot-password", asyncHandler(authController.forgotPassword));
router.post("/reset-password", asyncHandler(authController.resetPassword));
router.post("/invites", requireRole("Owner", "Manager"), asyncHandler(authController.createInvite));
router.get("/invites/:token", asyncHandler(authController.getInvite));
router.post("/invites/:token/accept", asyncHandler(authController.acceptInvite));

export default router;
