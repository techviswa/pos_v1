export const apiResponse = ({ message, data, meta }) => ({
  success: true,
  message,
  data,
  meta,
});

export const sendApiResponse = (res, { statusCode = 200, message, data, meta }) =>
  res.status(statusCode).json(
    apiResponse({
      message,
      data,
      meta,
    }),
  );

export const sendRawResponse = (res, { statusCode = 200, data }) =>
  res.status(statusCode).json(data);
