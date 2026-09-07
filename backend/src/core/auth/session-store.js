import { createHash } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import env from "../../config/env.js";
import { isDatabaseAvailable } from "../../config/db.js";

const memory = new Map();
const useMemory = () => env.nodeEnv !== "production" && !isDatabaseAvailable();
const hash = (token) => createHash("sha256").update(String(token || "")).digest("hex");
export const sessions = {
  async set(token, record) {
    if (useMemory()) { memory.set(token, record); return; }
    const data = { userId: record.userId, expiresAt: new Date(record.expiresAt) };
    await prisma.authSession.upsert({ where: { tokenHash: hash(token) }, create: { tokenHash: hash(token), ...data }, update: data });
  },
  async get(token) {
    if (useMemory()) return memory.get(token);
    const record = await prisma.authSession.findUnique({ where: { tokenHash: hash(token) } });
    return record ? { ...record, expiresAt: record.expiresAt.getTime() } : null;
  },
  async delete(token) {
    memory.delete(token);
    if (!useMemory()) await prisma.authSession.deleteMany({ where: { tokenHash: hash(token) } });
  },
};
