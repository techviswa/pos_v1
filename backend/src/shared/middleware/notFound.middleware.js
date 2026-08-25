import { createHttpError } from "../utils/http-error.js";

export const notFoundMiddleware = (req, _res, next) => {
  next(
    createHttpError({
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    }),
  );
};
