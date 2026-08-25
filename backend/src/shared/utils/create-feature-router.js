import { Router } from "express";

import { featureMiddleware } from "../middleware/feature.middleware.js";
import { asyncHandler } from "./asyncHandler.js";
import { createHttpError } from "./http-error.js";

export const createFeatureRouter = ({ featureKey, definitions }) => {
  const router = Router();

  router.use(featureMiddleware(featureKey));

  definitions.forEach(({ method, path, middleware, handler }) => {
    if (typeof router[method] !== "function") {
      throw createHttpError({
        statusCode: 500,
        code: "UNSUPPORTED_HTTP_METHOD",
        message: `Unsupported HTTP method '${method}' for feature '${featureKey}'`,
      });
    }

    const middlewares = Array.isArray(middleware) ? middleware : middleware ? [middleware] : [];
    router[method](path, ...middlewares, asyncHandler(handler));
  });

  return router;
};
