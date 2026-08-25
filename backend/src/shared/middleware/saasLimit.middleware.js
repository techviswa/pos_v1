import { saasService } from "../../core/saas/saas.service.js";

export const requireSaasLimit = (resource, getIncrement = () => 1) => async (req, _res, next) => {
  try {
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

