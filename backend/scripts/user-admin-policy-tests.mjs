import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { usersService } from "../src/core/users/users.service.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";

const businessId = `users-policy-${randomUUID()}`;
const otherBusinessId = `users-policy-other-${randomUUID()}`;
const scope = (id) => ({ businessId: id, tenantId: `tenant-${id}` });
const fails = async (promise) => { try { await promise; return null; } catch (error) { return `${error.statusCode}:${error.code || ""}`; } };
const asActor = (user) => ({ id: user.id, role: user.role, permissions: user.permissions });

try {
  await prisma.business.create({ data: { id: businessId, tenantId: `tenant-${businessId}`, name: "Policy test" } });
  await prisma.business.create({ data: { id: otherBusinessId, tenantId: `tenant-${otherBusinessId}`, name: "Other tenant" } });
  const outlet = await prisma.outlet.create({ data: { businessId, name: "Main", code: `M-${Date.now()}` } });
  const foreignOutlet = await prisma.outlet.create({ data: { businessId: otherBusinessId, name: "Foreign", code: `F-${Date.now()}` } });

  // Trusted (AdminCore-style) bootstrap: no actor.
  const owner = await usersService.createUser({ ...scope(businessId), payload: { email: "owner@t.test", password: "password-1234", role: "Owner", name: "Owner" } });
  const manager = await usersService.createUser({ ...scope(businessId), payload: { email: "mgr@t.test", password: "password-1234", role: "Manager", name: "Manager" } });
  const waiter = await usersService.createUser({ ...scope(businessId), payload: { email: "waiter@t.test", password: "password-1234", role: "Waiter", name: "Waiter" } });
  const ownerActor = asActor(owner), managerActor = asActor(manager), waiterActor = asActor(waiter);
  assert.equal(owner.role, "Owner");

  // A credential edit cannot partially reset a password before reporting an email conflict.
  const beforeConflict = await prisma.user.findUniqueOrThrow({ where: { id: waiter.id } });
  assert.equal(await fails(usersService.updateUser({ ...scope(businessId), userId: waiter.id, payload: {
    email: "  MGR@T.TEST  ", password: "must-not-be-applied", name: "Must not be applied",
  } })), "409:EMAIL_EXISTS");
  const afterConflict = await prisma.user.findUniqueOrThrow({ where: { id: waiter.id } });
  assert.equal(afterConflict.email, beforeConflict.email);
  assert.equal(afterConflict.passwordHash, beforeConflict.passwordHash);
  assert.equal(afterConflict.name, beforeConflict.name);

  // Outbox failure must not leave a changed password or revoke the old session.
  const sessionHash = randomUUID();
  await prisma.authSession.create({ data: { tokenHash: sessionHash, userId: waiter.id, expiresAt: new Date(Date.now() + 60000) } });
  const notify = admincoreChangeSyncService.notifyChange;
  admincoreChangeSyncService.notifyChange = async (_event, options) => {
    assert.ok(options?.tx, "profile notifications must participate in the credential transaction");
    throw new Error("fixture outbox failure");
  };
  try {
    await assert.rejects(usersService.updateUser({ ...scope(businessId), userId: waiter.id,
      payload: { password: "must-roll-back-password", name: "Must roll back" } }), /fixture outbox failure/);
  } finally { admincoreChangeSyncService.notifyChange = notify; }
  const afterFailure = await prisma.user.findUniqueOrThrow({ where: { id: waiter.id } });
  assert.equal(afterFailure.passwordHash, beforeConflict.passwordHash);
  assert.equal(afterFailure.name, beforeConflict.name);
  assert.equal(await prisma.authSession.count({ where: { tokenHash: sessionHash } }), 1);
  await prisma.authSession.delete({ where: { tokenHash: sessionHash } });

  // P0: self-service profile edit must not be a privilege-escalation path.
  const edited = await usersService.updateOwnProfile({ ...scope(businessId), userId: waiter.id, payload: {
    name: "Renamed", role: "Owner", permissions: ["staff", "settings", "reports", "inventory"], active: false, email: "evil@t.test" } });
  assert.equal(edited.name, "Renamed");
  assert.equal(edited.role, "Waiter", "role must not change through /me/profile");
  assert.deepEqual([...edited.permissions].sort(), ["bills", "billing", "waiter_view"].sort(), "permissions must not change through /me/profile");
  assert.equal(edited.active, true);
  assert.equal(edited.email, "waiter@t.test");

  // P0: a Manager cannot mint or take over an Owner.
  assert.equal(await fails(usersService.createUser({ ...scope(businessId), actor: managerActor, payload: { email: "o2@t.test", password: "password-1234", role: "Owner" } })), "403:USER_ADMIN_FORBIDDEN");
  assert.equal(await fails(usersService.createUser({ ...scope(businessId), actor: managerActor, payload: { email: "owner@t.test", password: "hijacked-pass", role: "Manager" } })), "409:EMAIL_EXISTS");
  assert.equal(await fails(usersService.updateUser({ ...scope(businessId), actor: managerActor, userId: owner.id, payload: { password: "hijacked-pass" } })), "403:USER_ADMIN_FORBIDDEN");
  assert.equal(await fails(usersService.updateUser({ ...scope(businessId), actor: managerActor, userId: waiter.id, payload: { role: "Owner" } })), "403:USER_ADMIN_FORBIDDEN");
  assert.equal(await fails(usersService.deleteUser({ ...scope(businessId), actor: managerActor, userId: owner.id })), "403:USER_ADMIN_FORBIDDEN");
  // ...and cannot grant what it does not hold.
  assert.equal(await fails(usersService.updateUserPermissions({ ...scope(businessId), actor: managerActor, userId: waiter.id, permissions: ["settings"] })), "403:USER_ADMIN_FORBIDDEN");
  assert.equal(await fails(usersService.updateUserPermissions({ ...scope(businessId), actor: ownerActor, userId: waiter.id, permissions: ["made-up"] })), "400:INVALID_PERMISSION");
  // Legitimate delegation still works.
  const cashier = await usersService.createUser({ ...scope(businessId), actor: managerActor, payload: { email: "cash@t.test", password: "password-1234", role: "Cashier" } });
  assert.equal(cashier.role, "Cashier");

  // Role names cannot be invented or smuggled past the Owner check by spelling.
  assert.equal(await fails(usersService.createUser({ ...scope(businessId), actor: managerActor, payload: { email: "x@t.test", password: "password-1234", role: "O-wner " } })), "403:USER_ADMIN_FORBIDDEN");
  assert.equal(await fails(usersService.createUser({ ...scope(businessId), actor: ownerActor, payload: { email: "y@t.test", password: "password-1234", role: "Superuser" } })), "400:INVALID_ROLE");

  // Outlets must belong to the business.
  assert.equal(await fails(usersService.assignUserOutlets({ ...scope(businessId), actor: ownerActor, userId: waiter.id, outletIds: [foreignOutlet.id] })), "400:OUTLET_NOT_IN_BUSINESS");
  const assigned = await usersService.assignUserOutlets({ ...scope(businessId), actor: ownerActor, userId: waiter.id, outletIds: [outlet.id] });
  assert.deepEqual(assigned.assigned_outlet_ids, [outlet.id]);

  // Lockout protection.
  assert.equal(await fails(usersService.updateUser({ ...scope(businessId), actor: ownerActor, userId: owner.id, payload: { role: "Manager" } })), "403:USER_ADMIN_FORBIDDEN");
  assert.equal(await fails(usersService.updateUser({ ...scope(businessId), actor: ownerActor, userId: owner.id, payload: { active: false } })), "403:USER_ADMIN_FORBIDDEN");
  assert.equal(await fails(usersService.deleteUser({ ...scope(businessId), actor: ownerActor, userId: owner.id })), "403:USER_ADMIN_FORBIDDEN");
  const secondOwner = await usersService.createUser({ ...scope(businessId), actor: ownerActor, payload: { email: "owner2@t.test", password: "password-1234", role: "Owner" } });
  assert.equal(await fails(usersService.deleteUser({ ...scope(businessId), actor: asActor(secondOwner), userId: owner.id })), null, "with two owners one may be removed by the other");
  assert.equal(await fails(usersService.updateUser({ ...scope(businessId), userId: secondOwner.id, payload: { role: "Manager" } })), "409:LAST_OWNER", "even trusted callers cannot orphan a business");

  // Trusted bridge callers keep their upsert behaviour (AdminCore password/role sync).
  const synced = await usersService.createUser({ ...scope(businessId), payload: { email: "mgr@t.test", password: "rotated-password-9", role: "Manager", name: "Manager v2" } });
  assert.equal(synced.id, manager.id);
  assert.equal(synced.name, "Manager v2");

  console.log("User administration policy: escalation, takeover, delegation and lockout guards passed");
} finally {
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.$disconnect();
}
