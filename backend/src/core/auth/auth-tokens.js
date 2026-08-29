import { randomBytes } from "crypto";

import { isDatabaseAvailable } from "../../config/db.js";
import env from "../../config/env.js";
import prisma from "../../database/prisma/client.js";

const tokenStore = new Map();

const canUseMemoryFallback = () => !isDatabaseAvailable() && env.nodeEnv !== "production";

const toMemoryRecord = ({ type, userId, ttlMs, metadata }) => ({
  type,
  userId,
  metadata,
  expiresAt: Date.now() + ttlMs,
  usedAt: null,
  createdAt: new Date().toISOString(),
});

const serializeDbToken = (record) => ({
  type: record.type,
  userId: record.userId,
  metadata: record.metadata || {},
  expiresAt: record.expiresAt.getTime(),
  usedAt: record.usedAt ? record.usedAt.toISOString() : null,
  createdAt: record.createdAt ? record.createdAt.toISOString() : null,
});

export const createAuthToken = async ({ type, userId, ttlMs, metadata = {} }) => {
  const token = randomBytes(32).toString("hex");
  const memoryRecord = toMemoryRecord({ type, userId, ttlMs, metadata });

  if (canUseMemoryFallback()) {
    tokenStore.set(token, memoryRecord);
    return token;
  }

  await prisma.authToken.create({
    data: {
      token,
      type,
      userId: userId || null,
      metadata,
      expiresAt: new Date(memoryRecord.expiresAt),
    },
  });

  return token;
};

export const consumeAuthToken = async ({ token, type }) => {
  const tokenValue = String(token || "");

  if (!canUseMemoryFallback()) {
    const record = await prisma.authToken.findUnique({ where: { token: tokenValue } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return null;
    }

    const usedRecord = await prisma.authToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return serializeDbToken(usedRecord);
  }

  const record = tokenStore.get(tokenValue);
  if (!record || record.type !== type || record.usedAt || record.expiresAt < Date.now()) {
    return null;
  }

  record.usedAt = new Date().toISOString();
  tokenStore.set(tokenValue, record);
  return record;
};

export const getAuthToken = async ({ token, type }) => {
  const tokenValue = String(token || "");

  if (!canUseMemoryFallback()) {
    const record = await prisma.authToken.findUnique({ where: { token: tokenValue } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return null;
    }
    return serializeDbToken(record);
  }

  const record = tokenStore.get(tokenValue);
  if (!record || record.type !== type || record.usedAt || record.expiresAt < Date.now()) {
    return null;
  }

  return record;
};
