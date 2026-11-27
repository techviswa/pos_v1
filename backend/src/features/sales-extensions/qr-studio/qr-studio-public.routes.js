import { Router } from "express";
import { asyncHandler } from "../../../shared/utils/asyncHandler.js";
import { qrLinksService } from "./qr-links.service.js";
import { qrBrandService } from "./qr-brand.service.js";

// Guest-facing: what a smart code opens, and the outlet's brand images.
const router = Router();
router.get("/links/:token", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ success: true, data: await qrLinksService.resolve({ token: req.params.token, requestMeta: { refresh: req.query.refresh === "1", userAgent: req.get("user-agent"), ipAddress: req.ip } }) });
}));
router.get("/brand/:businessId/:outletKey/:kind", asyncHandler((req, res) => qrBrandService.serveImage(req, res)));
export default router;
