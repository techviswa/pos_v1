import { randomBytes } from "crypto";

const tokenStore = new Map();

export const createAuthToken = ({ type, userId, ttlMs, metadata = {} }) => {
  const token = randomBytes(32).toString("hex");
  tokenStore.set(token, {
    type,
    userId,
    metadata,
    expiresAt: Date.now() + ttlMs,
    usedAt: null,
    createdAt: new Date().toISOString(),
  });
  return token;
};

export const consumeAuthToken = ({ token, type }) => {
  const record = tokenStore.get(String(token || ""));

  if (!record || record.type !== type || record.usedAt || record.expiresAt < Date.now()) {
    return null;
  }

  record.usedAt = new Date().toISOString();
  tokenStore.set(token, record);
  return record;
};

export const getAuthToken = ({ token, type }) => {
  const record = tokenStore.get(String(token || ""));

  if (!record || record.type !== type || record.usedAt || record.expiresAt < Date.now()) {
    return null;
  }

  return record;
};

