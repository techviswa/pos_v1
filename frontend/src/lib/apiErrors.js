export const getApiErrorStatus = (error) => Number(error?.response?.status || error?.status || 0);

export const getApiErrorTitle = (error) => {
  const status = getApiErrorStatus(error);

  if (!error?.response) {
    return "Backend unavailable";
  }
  if (status === 401) {
    return "Session expired";
  }
  if (status === 403) {
    return "Access denied";
  }
  if (status === 404) {
    return "Feature not available";
  }
  if (status >= 500) {
    return "Server error";
  }

  return "Request failed";
};

export const getApiErrorMessage = (error, fallback = "Something went wrong. Please try again.") => {
  if (!error) {
    return fallback;
  }

  if (!error.response) {
    return "Backend server is not reachable. Start the backend and try again.";
  }

  const payload = error.response.data || {};
  const message =
    payload.error?.message ||
    payload.message ||
    payload.detail ||
    error.message;

  if (Array.isArray(message)) {
    return message
      .map((entry) => entry?.msg || entry?.message || String(entry))
      .filter(Boolean)
      .join(" ");
  }

  return message ? String(message) : fallback;
};

export const getApiErrorDetails = (error, fallback) => {
  const status = getApiErrorStatus(error);
  const message = getApiErrorMessage(error, fallback);

  if (!error?.response) {
    return {
      title: "Backend unavailable",
      message,
      status: null,
      action: "Start the backend server and retry this screen.",
    };
  }

  if (status === 401) {
    return {
      title: "Session expired",
      message: "Please sign in again to continue.",
      status,
      action: "Your login session is no longer valid.",
    };
  }

  if (status === 403) {
    return {
      title: "Access denied",
      message: message || "Your role does not have access to this screen.",
      status,
      action: "Use an Owner or Manager account, or update this staff role's permissions.",
    };
  }

  if (status === 404) {
    return {
      title: "Feature not available",
      message: message || "This backend endpoint is not available yet.",
      status,
      action: "This screen needs a matching backend route before it can load.",
    };
  }

  if (status >= 500) {
    return {
      title: "Server error",
      message: message || "The backend hit an internal error.",
      status,
      action: "Check the backend terminal or backend/logs/errors.jsonl for the request error.",
    };
  }

  return {
    title: getApiErrorTitle(error),
    message,
    status: status || null,
    action: "",
  };
};
