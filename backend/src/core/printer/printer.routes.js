import { Router } from "express";

import { requireAnyPermission } from "../../shared/middleware/authGuard.middleware.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { printerController } from "./printer.controller.js";
import { timingSafeEqual } from "node:crypto";
import { createHttpError } from "../../shared/utils/http-error.js";

const router = Router();

router.use("/agent", (req, _res, next) => {
  try {
    const agents = JSON.parse(process.env.PRINTER_AGENTS_JSON || "{}");
    const id = String(req.get("x-printer-agent-id") || "");
    const config = agents[id];
    const expected = Buffer.from(String(config?.key || ""));
    const actual = Buffer.from(String(req.get("x-printer-agent-key") || ""));
    if (!config?.business_id || !expected.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw createHttpError({ statusCode: 401, message: "Invalid printer agent credentials" });
    }
    req.context = { ...req.context, businessId: config.business_id };
    req.printerAgentId = id;
    next();
  } catch (error) { next(error); }
});

router.post("/agent/heartbeat", asyncHandler(printerController.agentHeartbeat));
router.post("/agent/claim-next", asyncHandler(printerController.claimNext));
router.post("/agent/jobs/:jobId/complete", asyncHandler(printerController.complete));
router.post("/agent/jobs/:jobId/fail", asyncHandler(printerController.fail));
router.get("/agents", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.listAgents));
router.get("/", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.list));
router.post("/", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.create));
router.get("/:jobId", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.getById));
router.post("/:jobId/complete", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.complete));
router.post("/:jobId/fail", requireAnyPermission("billing", "bills", "kot"), asyncHandler(printerController.fail));

export default router;
