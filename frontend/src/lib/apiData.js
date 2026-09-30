/**
 * The payload of an API response. A global axios interceptor (index.js) already unwraps { success, data } envelopes,
 * but requests made before it is installed (or by other axios instances) are not unwrapped; this handles both.
 */
export const apiData = (response) => {
  const payload = response?.data;
  if (payload && typeof payload === "object" && !Array.isArray(payload)
    && Object.prototype.hasOwnProperty.call(payload, "success") && Object.prototype.hasOwnProperty.call(payload, "data")) {
    return payload.data;
  }
  return payload;
};
