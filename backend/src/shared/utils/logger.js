const formatLogEntry = (level, message) => {
  const timestamp = new Date().toISOString();

  if (typeof message === "string") {
    return [`[${level}]`, timestamp, message];
  }

  return [`[${level}]`, timestamp, JSON.stringify(message)];
};

export const logger = {
  info: (message) => console.log(...formatLogEntry("info", message)),
  warn: (message) => console.warn(...formatLogEntry("warn", message)),
  error: (message) => console.error(...formatLogEntry("error", message)),
};
