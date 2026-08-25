export const createHttpError = (input, fallbackStatusCode = 500) => {
  const config =
    typeof input === "object" && input !== null
      ? input
      : {
          message: input,
          statusCode: fallbackStatusCode,
        };

  const error = new Error(config.message || "Internal server error");
  error.statusCode = Number(config.statusCode || fallbackStatusCode);
  error.code = config.code || "HTTP_ERROR";
  error.details = config.details;
  return error;
};

export const createNotFoundError = (entityName, details) =>
  createHttpError({
    statusCode: 404,
    code: "NOT_FOUND",
    message: `${entityName} not found`,
    details,
  });
