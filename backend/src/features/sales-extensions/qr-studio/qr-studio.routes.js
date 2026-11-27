import { requireAnyPermission, requirePermission } from "../../../shared/middleware/authGuard.middleware.js";
import { assertOutletAllowed } from "../../../shared/middleware/outletScope.js";
import { FEATURE_KEYS } from "../../../shared/constants/module.constants.js";
import { createFeatureRouter } from "../../../shared/utils/create-feature-router.js";
import { qrLinksService } from "./qr-links.service.js";
import { qrBrandService } from "./qr-brand.service.js";
import { qrInsights } from "./qr-insights.js";

// QR Studio (plan feature): smart codes, guest-menu branding per outlet, and per-code performance.
const manage = requirePermission("qr_management");
const base = (req) => ({ businessId: req.context.businessId, outletScope: req.context.outletScope || null });
const outletParam = (req) => {
  const outletId = req.query.outlet_id ? String(req.query.outlet_id) : null;
  assertOutletAllowed(req, outletId);
  return outletId;
};

export default createFeatureRouter({
  featureKey: FEATURE_KEYS.QR_STUDIO,
  definitions: [
    { method: "get", path: "/links", middleware: manage, handler: async (req, res) => res.json({ success: true, data: await qrLinksService.list(base(req)) }) },
    { method: "post", path: "/links", middleware: manage, handler: async (req, res) => res.status(201).json({ success: true, data: await qrLinksService.create({ ...base(req), payload: req.body || {} }) }) },
    { method: "put", path: "/links/:linkId", middleware: manage, handler: async (req, res) => res.json({ success: true, data: await qrLinksService.update({ ...base(req), linkId: req.params.linkId, payload: req.body || {} }) }) },
    { method: "get", path: "/brand", middleware: manage, handler: async (req, res) => res.json({ success: true, data: await qrBrandService.get({ businessId: req.context.businessId, outletId: outletParam(req) }) }) },
    { method: "put", path: "/brand", middleware: manage, handler: async (req, res) => res.json({ success: true, data: await qrBrandService.save({ businessId: req.context.businessId, outletId: outletParam(req), payload: req.body || {}, user: req.user }) }) },
    { method: "get", path: "/insights", middleware: requireAnyPermission("qr_management", "reports"), handler: async (req, res) => {
      // No outlet chosen: everything the user may see (their own outlets when restricted).
      const outletId = req.query.outlet_id ? outletParam(req) : null;
      res.set("Cache-Control", "private, no-store");
      res.json({ success: true, data: await qrInsights({ businessId: req.context.businessId, outletIds: outletId ? [outletId] : req.context.outletScope || null, query: req.query }) });
    } },
  ],
});
