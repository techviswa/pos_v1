import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import env from "../src/config/env.js";
import prisma from "../src/database/prisma/client.js";
import { authService } from "../src/core/auth/auth.service.js";
import { createAuthToken } from "../src/core/auth/auth-tokens.js";

const id = `invite-test-${randomUUID()}`;
const previous = env.nodeEnv;
env.nodeEnv = "production";
try {
  await prisma.business.create({ data: { id, tenantId: id, name: "Invite test" } });
  const input = { businessId: id, email: `${id}@example.invalid`, role: "Cashier", actorRole: "Manager" };
  await assert.rejects(authService.createInvite({ ...input, role: "Owner" }), /cannot invite/);
  await assert.rejects(authService.createInvite({ ...input, role: "Unknown" }), /cannot invite/);
  const invite = await authService.createInvite(input);
  const user = await authService.acceptInvite({ token: invite.invite_token, password: "Testing-password-123", name: "Test" });
  assert.equal(user.role, "Cashier");
  assert.ok(user.permissions.includes("billing"));
  const before = await prisma.user.findUnique({ where: { id: user.id } });
  await assert.rejects(authService.createInvite(input), /already belongs/);
  const oldInvite = await createAuthToken({ type: "invite", ttlMs: 60000,
    metadata: { business_id: id, email: input.email, role: "Owner" } });
  assert.equal(await authService.acceptInvite({ token: oldInvite, password: "Overwrite-attempt-123" }), null);
  const after = await prisma.user.findUnique({ where: { id: user.id } });
  assert.equal(after.passwordHash, before.passwordHash);
  assert.equal(after.roleId, before.roleId);
  console.log("Invite role escalation, existing-account takeover, and staff permissions checks passed");
} finally {
  env.nodeEnv = previous;
  await prisma.authToken.deleteMany({ where: { metadata: { path: ["business_id"], equals: id } } });
  await prisma.business.deleteMany({ where: { id } });
  await prisma.$disconnect();
}
