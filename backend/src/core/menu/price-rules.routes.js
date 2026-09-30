import { Router } from "express";

import { apiResponse } from "../../shared/utils/apiResponse.js";
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { requireAnyPermission, requirePermission } from "../../shared/middleware/authGuard.middleware.js";
import { priceRulesService } from "./price-rules.service.js";

const router = Router();
const scope = (req) => ({ businessId: req.context.businessId, tenantId: req.context.tenantId });
const manage = requirePermission("price_rules");

router.get("/", requireAnyPermission("price_rules", "products", "billing", "reports"), asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Price rules fetched", data: await priceRulesService.list(scope(req)) }));
}));
router.post("/", manage, asyncHandler(async (req, res) => {
  res.status(201).json(apiResponse({ message: "Price rule created", data: await priceRulesService.create({ ...scope(req), payload: req.body || {} }) }));
}));
router.put("/:ruleId", manage, asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Price rule updated", data: await priceRulesService.update({ ...scope(req), ruleId: req.params.ruleId, payload: req.body || {} }) }));
}));
router.delete("/:ruleId", manage, asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse({ message: "Price rule deleted", data: await priceRulesService.remove({ ...scope(req), ruleId: req.params.ruleId }) }));
}));

export default router;
