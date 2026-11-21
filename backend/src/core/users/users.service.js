import prisma from "../../database/prisma/client.js";
import { operationalWrite } from '../../shared/utils/operational-write.js';
import {
  ensureAccessControlSeed,
  ensureBusiness,
  ensureRole,
  serializeUser,
  syncUserOutlets,
  syncUserPermissions,
} from "../../database/prisma/helpers.js";
import {
  PERMISSION_LABELS,
  ROLE_DEFAULT_PERMISSIONS,
  STAFF_PERMISSION_KEYS,
  STAFF_ROLE_OPTIONS,
} from "../../shared/constants/access.constants.js";
import { DEFAULT_USER_ROLE } from "../../shared/constants/domain.constants.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { hashPassword, isPasswordHash } from "../auth/passwords.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

// Same normalisation the auth guards use, so "owner", "Owner" and "SYSTEM_OWNER" are all recognised as Owner.
const normalizeRoleName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^system[\s_-]+owner$/, "owner")
    .replace(/[\s_-]+/g, "");
const isOwnerRole = (value) => normalizeRoleName(value) === "owner";
const isManagerLevel = (value) => ["owner", "manager"].includes(normalizeRoleName(value));

const canonicalRoleName = (value) => {
  const match = STAFF_ROLE_OPTIONS.find((role) => normalizeRoleName(role) === normalizeRoleName(value));
  if (!match) {
    throw createHttpError({
      statusCode: 400,
      code: "INVALID_ROLE",
      message: `role must be one of: ${STAFF_ROLE_OPTIONS.join(", ")}`,
    });
  }
  return match;
};

const forbid = (message) => createHttpError({ statusCode: 403, code: "USER_ADMIN_FORBIDDEN", message });

const getUserInclude = () => ({
  business: true,
  role: true,
  permissions: {
    include: {
      permission: true,
    },
  },
  outletAssignments: {
    include: {
      outlet: true,
    },
  },
});

class UsersService {
  /**
   * Who may change whom. `actor` is the signed-in user behind a tenant-facing request; internal callers such as
   * the AdminCore bridge omit it and are trusted. Nobody may hand out more authority than they hold themselves.
   */
  assertActorMayAssignRole(actor, roleName) {
    if (!actor || isOwnerRole(actor.role)) return;
    if (isOwnerRole(roleName)) throw forbid("Only an Owner can assign the Owner role");
    // Someone given the Staff screen without being a Manager may only manage floor roles.
    if (!isManagerLevel(actor.role) && isManagerLevel(roleName)) throw forbid("Only an Owner or Manager can assign the Manager role");
  }

  assertActorMayModify(actor, target) {
    if (!actor || isOwnerRole(actor.role)) return;
    if (isOwnerRole(target.role?.name)) throw forbid("Only an Owner can modify an Owner account");
    if (!isManagerLevel(actor.role) && isManagerLevel(target.role?.name)) throw forbid("Only an Owner or Manager can modify a Manager account");
  }

  assertActorMayGrant(actor, permissions) {
    const requested = [...new Set((permissions || []).map(String))];
    const unknown = requested.filter((key) => !STAFF_PERMISSION_KEYS.includes(key));
    if (unknown.length) {
      throw createHttpError({ statusCode: 400, code: "INVALID_PERMISSION", message: `Unknown permission: ${unknown.join(", ")}` });
    }
    if (!actor || isOwnerRole(actor.role)) return;
    const held = new Set(actor.permissions || []);
    const excess = requested.filter((key) => !held.has(key));
    if (excess.length) throw forbid(`You cannot grant permissions you do not hold: ${excess.join(", ")}`);
  }

  async assertNotLastOwner({ businessId, userId, client = prisma }) {
    const otherOwners = await client.user.count({
      where: { businessId, active: true, id: { not: userId }, role: { name: { in: ["Owner", "System Owner"] } } },
    });
    if (!otherOwners) {
      throw createHttpError({ statusCode: 409, code: "LAST_OWNER", message: "A business must keep at least one active Owner" });
    }
  }

  async refreshActor(actor, businessId, tx) {
    if (!actor) return undefined;
    const record = await tx.user.findFirst({ where: { id: actor.id, businessId }, include: getUserInclude() });
    if (!record?.active) throw createHttpError({ statusCode: 403, code: 'ACTOR_PERMISSION_REVOKED', message: 'This staff administrator no longer has access' });
    const fresh = serializeUser(record);
    if ((!isOwnerRole(fresh.role) && !(fresh.permissions || []).includes('staff')) || (actor.admincore_owner_required && !isOwnerRole(fresh.role))) {
      throw createHttpError({ statusCode: 403, code: 'ACTOR_PERMISSION_REVOKED', message: 'Staff administration authority was revoked' });
    }
    return fresh;
  }

  async assertOutletsInBusiness(businessId, outletIds) {
    const wanted = [...new Set((outletIds || []).filter(Boolean).map(String))];
    if (!wanted.length) return [];
    const found = await prisma.outlet.count({ where: { id: { in: wanted }, businessId } });
    if (found !== wanted.length) {
      throw createHttpError({ statusCode: 400, code: "OUTLET_NOT_IN_BUSINESS", message: "One or more outlets do not belong to this business" });
    }
    return wanted;
  }

  normalizePassword(password, fallback = "") {
    const value = password || fallback;
    if (!isPasswordHash(value) && String(value).length < 8) {
      throw createHttpError({ statusCode: 400, message: "Password must be at least 8 characters" });
    }
    return isPasswordHash(value) ? value : hashPassword(value);
  }

  async listUsers({ tenantId, businessId }) {
    await ensureAccessControlSeed();
    const business = await ensureBusiness({ tenantId, businessId });
    const users = await prisma.user.findMany({
      where: { businessId: business.id },
      include: getUserInclude(),
      orderBy: { createdAt: "asc" },
    });

    return users.map(serializeUser);
  }

  async getUserById({ tenantId, businessId, userId }) {
    const business = await ensureBusiness({ tenantId, businessId });
    const user = await prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        businessId: business.id,
      },
      include: getUserInclude(),
    });

    return serializeUser(user);
  }

  async createUser({ tenantId, businessId, payload, actor, rejectExisting = false }) {
    const business = await ensureBusiness({ tenantId, businessId });
    const roleName = canonicalRoleName(payload.role || DEFAULT_USER_ROLE);
    this.assertActorMayAssignRole(actor, roleName);
    const permissions = payload.permissions || ROLE_DEFAULT_PERMISSIONS[roleName] || [];
    this.assertActorMayGrant(actor, permissions);
    const outletIds = await this.assertOutletsInBusiness(business.id, payload.assigned_outlet_ids);
    const role = await ensureRole(roleName);
    const email = payload.email || `${Date.now()}@pos.local`;
    return operationalWrite({ businessId: business.id, kind: "staff-create",
      payload: { ...payload, request_id: payload.admincore_command_id || payload.request_id } }, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`business-owners:${business.id}`}))`;
    const freshActor = await this.refreshActor(actor, business.id, tx);
    this.assertActorMayAssignRole(freshActor, roleName);
    this.assertActorMayGrant(freshActor, permissions);
    const existingUser = await tx.user.findUnique({
      where: { businessId_email: { businessId: business.id, email } },
      include: getUserInclude(),
    });

    if (existingUser && (actor || rejectExisting)) {
      // A signed-in user creating staff must never silently take over an existing account.
      throw createHttpError({ statusCode: 409, code: "EMAIL_EXISTS", message: "A user with this email already exists" });
    }

    if (existingUser) {
      const roleChanged = normalizeRoleName(roleName) !== normalizeRoleName(existingUser.role?.name);
      if (isOwnerRole(existingUser.role?.name) && (roleChanged || payload.active === false)) await this.assertNotLastOwner({ businessId: business.id, userId: existingUser.id, client: tx });
      const updatedUser = await tx.user.update({
        where: { id: existingUser.id },
        data: {
          roleId: role.id,
          name: payload.name || existingUser.name,
          passwordHash:
            payload.password !== undefined ? this.normalizePassword(payload.password) : existingUser.passwordHash,
          profileRequired: payload.profile_required ?? existingUser.profileRequired,
          active: payload.active ?? existingUser.active,
          bio: payload.bio ?? existingUser.bio,
        },
        include: getUserInclude(),
      });

      await syncUserPermissions(updatedUser.id, permissions, tx);
      await syncUserOutlets(updatedUser.id, outletIds, tx);
      if (payload.password !== undefined || payload.active === false || roleChanged) await tx.authSession.deleteMany({ where: { userId: existingUser.id } });

      const user = await tx.user.findUniqueOrThrow({
        where: { id: updatedUser.id },
        include: getUserInclude(),
      });

      const serializedUser = serializeUser(user);
      await admincoreChangeSyncService.notifyChange({
        resource: "staff",
        action: "updated",
        recordId: serializedUser.id,
        tenantId,
        businessId: business.id,
        metadata: {
          name: serializedUser.name,
          email: serializedUser.email,
          role: serializedUser.role,
          active: serializedUser.active,
        },
      }, { tx });

      return serializedUser;
    }

    const createdUser = await tx.user.create({
      data: {
        businessId: business.id,
        roleId: role.id,
        name: payload.name || "New Staff",
        email,
        passwordHash: this.normalizePassword(payload.password),
        profileRequired: payload.profile_required ?? true,
        active: payload.active ?? true,
        bio: payload.bio || null,
      },
      include: getUserInclude(),
    });

    await syncUserPermissions(createdUser.id, permissions, tx);
    await syncUserOutlets(createdUser.id, outletIds, tx);

    const user = await tx.user.findUniqueOrThrow({
      where: { id: createdUser.id },
      include: getUserInclude(),
    });

    const serializedUser = serializeUser(user);
    await admincoreChangeSyncService.notifyChange({
      resource: "staff",
      action: "updated",
      recordId: serializedUser.id,
      tenantId,
      businessId: business.id,
      metadata: {
        name: serializedUser.name,
        email: serializedUser.email,
        role: serializedUser.role,
        active: serializedUser.active,
      },
    }, { tx });

    return serializedUser;
    });
  }

  async updateUser({ tenantId, businessId, userId, payload, actor }) {
    const requestPayload = payload;
    if (payload.name !== undefined) {
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 120) {
        throw createHttpError({ statusCode: 400, code: 'USER_NAME_INVALID', message: 'Name must contain 1 to 120 characters' });
      }
      payload = { ...payload, name: payload.name.trim() };
    }
    const business = await ensureBusiness({ tenantId, businessId });
    const currentUser = await prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        businessId: business.id,
      },
      include: getUserInclude(),
    });

    this.assertActorMayModify(actor, currentUser);
    let roleId = currentUser.roleId;
    let roleChanged = false;
    if (payload.role) {
      const roleName = canonicalRoleName(payload.role);
      this.assertActorMayAssignRole(actor, roleName);
      if (normalizeRoleName(roleName) !== normalizeRoleName(currentUser.role?.name)) {
        if (actor && actor.id === userId) throw forbid("You cannot change your own role");
        roleChanged = true;
      }
      const role = await ensureRole(roleName);
      roleId = role.id;
      if (roleChanged && payload.reset_permissions_for_role === true && payload.permissions === undefined) {
        payload = { ...payload, permissions: ROLE_DEFAULT_PERMISSIONS[roleName] || [] };
      }
    }
    if (actor && actor.id === userId && payload.active === false) throw forbid("You cannot deactivate your own account");
    // Demoting or deactivating the only Owner would leave the business without anyone able to administer it.
    if (isOwnerRole(currentUser.role?.name) && (roleChanged || payload.active === false)) {
      await this.assertNotLastOwner({ businessId: business.id, userId });
    }
    if (payload.permissions !== undefined) this.assertActorMayGrant(actor, payload.permissions || []);
    const assignedOutletIds = payload.assigned_outlet_ids !== undefined
      ? await this.assertOutletsInBusiness(business.id, payload.assigned_outlet_ids)
      : undefined;

    const nextPasswordHash =
      payload.password !== undefined ? this.normalizePassword(payload.password) : currentUser.passwordHash;

    let nextEmail = currentUser.email;
    if (payload.email !== undefined) {
      if (typeof payload.email !== "string" || !payload.email.trim()) {
        throw createHttpError({ statusCode: 400, code: "EMAIL_REQUIRED", message: "Email is required" });
      }
      nextEmail = payload.email.trim().toLowerCase();
      if (nextEmail !== currentUser.email) {
        const duplicate = await prisma.user.findFirst({
          where: { businessId: business.id, email: { equals: nextEmail, mode: "insensitive" }, id: { not: userId } },
          select: { id: true },
        });
        if (duplicate) {
          throw createHttpError({ statusCode: 409, code: "EMAIL_EXISTS", message: "A user with that email already exists in this business" });
        }
      }
    }

    return operationalWrite({ businessId: business.id, kind: `staff-update:${userId}`,
      payload: { ...requestPayload, request_id: requestPayload.admincore_command_id || requestPayload.request_id } }, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`business-owners:${business.id}`}))`;
      const freshActor = await this.refreshActor(actor, business.id, tx);
      this.assertActorMayModify(freshActor, currentUser);
      if (payload.role) this.assertActorMayAssignRole(freshActor, canonicalRoleName(payload.role));
      if (payload.permissions !== undefined) this.assertActorMayGrant(freshActor, payload.permissions || []);
      if (isOwnerRole(currentUser.role?.name) && (roleChanged || payload.active === false)) await this.assertNotLastOwner({ businessId: business.id, userId, client: tx });
      const applied = await tx.user.updateMany({
        where: { id: userId, businessId: business.id, updatedAt: currentUser.updatedAt },
        data: {
          name: payload.name ?? currentUser.name, email: nextEmail,
          passwordHash: nextPasswordHash, roleId,
          profileRequired: payload.profile_required ?? currentUser.profileRequired,
          active: payload.active ?? currentUser.active, bio: payload.bio ?? currentUser.bio,
        },
      });
      if (!applied.count) throw createHttpError({ statusCode: 409, code: 'STAFF_VERSION_CONFLICT', message: 'The staff profile changed during this update; refresh and review the current profile' });
      if (payload.permissions !== undefined) await syncUserPermissions(userId, payload.permissions || [], tx);
      if (assignedOutletIds !== undefined) await syncUserOutlets(userId, assignedOutletIds, tx);
      if (payload.password !== undefined || nextEmail !== currentUser.email || payload.active === false || roleChanged) {
        await tx.authSession.deleteMany({ where: { userId } });
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: getUserInclude() });
      // Persist the notification in the same database transaction as the credentials.
      // A failure rolls back the password, access changes and session revocation.
      await admincoreChangeSyncService.notifyChange({
        resource: "staff", action: "updated", recordId: userId, tenantId, businessId: business.id,
      }, { tx });
      return serializeUser(user);
    });
  }

  async deleteUser({ tenantId, businessId, userId, actor }) {
    const business = await ensureBusiness({ tenantId, businessId });
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`business-owners:${business.id}`}))`;
      const freshActor = await this.refreshActor(actor, business.id, tx);
      const deletedUser = await tx.user.findFirstOrThrow({ where: { id: userId, businessId: business.id }, include: getUserInclude() });
      this.assertActorMayModify(freshActor, deletedUser);
      if (actor && actor.id === userId) throw forbid("You cannot delete your own account");
      if (isOwnerRole(deletedUser.role?.name)) await this.assertNotLastOwner({ businessId: business.id, userId, client: tx });
      await tx.authSession.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
      const serializedUser = serializeUser(deletedUser);
      await admincoreChangeSyncService.notifyChange({
        resource: "staff", action: "deleted", recordId: serializedUser.id, tenantId, businessId: business.id,
        metadata: { name: serializedUser.name, email: serializedUser.email, role: serializedUser.role, active: serializedUser.active },
      }, { tx });
      return serializedUser;
    });
  }

  async updateOwnProfile({ tenantId, businessId, userId, payload = {} }) {
    // Self-service may only touch personal details. Role, permissions, status, email and outlets are
    // administrative and must never be settable by the account holder.
    const allowed = {};
    for (const key of ["name", "bio"]) {
      if (payload[key] !== undefined) allowed[key] = payload[key];
    }
    return this.updateUser({
      tenantId,
      businessId,
      userId,
      payload: { ...allowed, profile_required: false },
    });
  }

  async getUserActivity({ tenantId, businessId, userId }) {
    const business = await ensureBusiness({ tenantId, businessId });
    const user = await prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        businessId: business.id,
      },
    });

    const items = await prisma.staffActivity.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (!items.length) {
      const bootstrappedActivity = await prisma.staffActivity.create({
        data: {
          userId,
          action: "login",
          actorName: user.name,
        },
      });

      return {
        userId,
        items: [
          {
            id: bootstrappedActivity.id,
            action: bootstrappedActivity.action,
            actor: bootstrappedActivity.actorName || user.name,
            at: bootstrappedActivity.createdAt.toISOString(),
          },
        ],
      };
    }

    return {
      userId,
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        actor: item.actorName || user.name,
        at: item.createdAt.toISOString(),
      })),
    };
  }

  async getAccessMetadata() {
    await ensureAccessControlSeed();

    return {
      roles: STAFF_ROLE_OPTIONS,
      permissions: STAFF_PERMISSION_KEYS,
      labels: PERMISSION_LABELS,
      defaults: ROLE_DEFAULT_PERMISSIONS,
    };
  }

  async updateUserPermissions({ tenantId, businessId, userId, permissions, actor }) {
    return this.updateUser({
      tenantId,
      businessId,
      userId,
      actor,
      payload: { permissions: permissions || [] },
    });
  }

  async assignUserOutlets({ tenantId, businessId, userId, outletIds, actor }) {
    return this.updateUser({
      tenantId,
      businessId,
      userId,
      actor,
      payload: { assigned_outlet_ids: outletIds || [] },
    });
  }
}

export const usersService = new UsersService();

