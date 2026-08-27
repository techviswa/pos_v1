import { saasService } from "../../core/saas/saas.service.js";
import env from "../../config/env.js";

const getBearerToken = (authorization = "") => {
  const [scheme, token] = String(authorization || "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
};

const isTrustedAdminCoreBridgeRequest = (req) => {
  const bridgeKey = env.admincore.apiKey;
  if (!env.admincore.enabled || !bridgeKey) return false;

  const apiKey = req.get("x-api-key");
  const bearerToken = getBearerToken(req.get("authorization"));
  return apiKey === bridgeKey || bearerToken === bridgeKey;
};

export const requireSaasLimit = (resource, getIncrement = () => 1) => async (req, _res, next) => {
  try {
    if (resource === "staff" && isTrustedAdminCoreBridgeRequest(req)) {
      return next();
    }

    await saasService.assertWithinLimit({
      businessId: req.context?.businessId,
      resource,
      increment: Number(getIncrement(req) || 1),
    });
    next();
  } catch (error) {
    next(error);
  }
};
