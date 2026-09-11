import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import env from "../src/config/env.js";
import prisma from "../src/database/prisma/client.js";
import { createAuthToken, getAuthToken, consumeAuthToken } from "../src/core/auth/auth-tokens.js";

const previous = env.nodeEnv;
env.nodeEnv = "production";
const type = `test-${randomUUID()}`;
try {
  const token = await createAuthToken({ type, ttlMs: 60000 });
  const stored = await prisma.authToken.findFirst({ where: { type } });
  assert.notEqual(stored.token, token);
  assert.match(stored.token, /^sha256:[a-f0-9]{64}$/);
  assert.ok(await getAuthToken({ token, type }));
  assert.equal(await getAuthToken({ token: stored.token, type }), null);
  assert.equal(await consumeAuthToken({ token, type: "wrong-type" }), null);
  const outcomes = await Promise.all([consumeAuthToken({ token, type }), consumeAuthToken({ token, type })]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(await getAuthToken({ token, type }), null);
  const legacy = randomBytes(32).toString("hex");
  await prisma.authToken.create({ data: { token: legacy, type, expiresAt: new Date(Date.now() + 60000) } });
  assert.ok(await consumeAuthToken({ token: legacy, type }));
  console.log("Reset/invite token digest storage, bearer rejection, one-time redemption and legacy links passed");
} finally {
  env.nodeEnv = previous;
  await prisma.authToken.deleteMany({ where: { type } });
  await prisma.$disconnect();
}
