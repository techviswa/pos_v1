const SESSION_SLOT_KEY = "cashflow-lite-tab-session-id";

export const getTabSessionId = () => {
  try {
    return window.sessionStorage.getItem(SESSION_SLOT_KEY) || "";
  } catch {
    return "";
  }
};

export const getTabSessionHeaders = () => {
  const sessionId = getTabSessionId();
  return sessionId ? { "x-cf-session-id": sessionId } : {};
};

export const setTabSessionId = (sessionId) => {
  try {
    if (sessionId) {
      window.sessionStorage.setItem(SESSION_SLOT_KEY, sessionId);
      return;
    }
    window.sessionStorage.removeItem(SESSION_SLOT_KEY);
  } catch {
    // Session cookies still provide fallback auth if tab storage is unavailable.
  }
};

export const clearTabSessionId = () => setTabSessionId("");
