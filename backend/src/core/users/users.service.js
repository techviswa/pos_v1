import prisma from "../../database/prisma/client.js";
import {
  ensureAccessControlSeed,
  ensureBusiness,
  ensureRole,
  serializeUser,
  syncUserOutlets,
  syncUserPermissions,
} from "../../database/prisma/helpers.js";
import {
  ROLE_DEFAULT_PERMISSIONS,
  STAFF_PERMISSION_KEYS,
  STAFF_ROLE_OPTIONS,
} from "../../shared/constants/access.constants.js";
import { DEFAULT_USER_ROLE } from "../../shared/constants/domain.constants.js";
import { hashPassword, isPasswordHash } from "../auth/passwords.js";

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
  normalizePassword(password, fallback = "changeme123") {
    const value = password || fallback;
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

  async createUser({ tenantId, businessId, payload }) {
    const business = await ensureBusiness({ tenantId, businessId });
    const roleName = payload.role || DEFAULT_USER_ROLE;
    const role = await ensureRole(roleName);
    const permissions = payload.permissions || ROLE_DEFAULT_PERMISSIONS[roleName] || [];

    const createdUser = await prisma.user.create({
      data: {
        businessId: business.id,
        roleId: role.id,
        name: payload.name || "New Staff",
        email: payload.email || `${Date.now()}@pos.local`,
        passwordHash: this.normalizePassword(payload.password),
        profileRequired: payload.profile_required ?? true,
        active: payload.active ?? true,
        bio: payload.bio || null,
      },
      include: getUserInclude(),
    });

    await syncUserPermissions(createdUser.id, permissions);
    await syncUserOutlets(createdUser.id, payload.assigned_outlet_ids || []);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: createdUser.id },
      include: getUserInclude(),
    });

    return serializeUser(user);
  }

  async updateUser({ tenantId, businessId, userId, payload }) {
    const business = await ensureBusiness({ tenantId, businessId });
    const currentUser = await prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        businessId: business.id,
      },
      include: getUserInclude(),
    });

    let roleId = currentUser.roleId;
    if (payload.role) {
      const role = await ensureRole(payload.role);
      roleId = role.id;
    }

    const nextPasswordHash =
      payload.password !== undefined ? this.normalizePassword(payload.password) : currentUser.passwordHash;

    await prisma.user.update({
      where: { id: userId },
      data: {
        name: payload.name ?? currentUser.name,
        email: payload.email ?? currentUser.email,
        passwordHash: nextPasswordHash,
        roleId,
        profileRequired: payload.profile_required ?? currentUser.profileRequired,
        active: payload.active ?? currentUser.active,
        bio: payload.bio ?? currentUser.bio,
      },
    });

    if (payload.permissions !== undefined) {
      await syncUserPermissions(userId, payload.permissions || []);
    }

    if (payload.assigned_outlet_ids !== undefined) {
      await syncUserOutlets(userId, payload.assigned_outlet_ids || []);
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: getUserInclude(),
    });

    return serializeUser(user);
  }

  async deleteUser({ tenantId, businessId, userId }) {
    const business = await ensureBusiness({ tenantId, businessId });
    const deletedUser = await prisma.user.findFirstOrThrow({
      where: {
        id: userId,
        businessId: business.id,
      },
      include: getUserInclude(),
    });

    await prisma.user.delete({
      where: { id: userId },
    });

    return serializeUser(deletedUser);
  }

  async updateOwnProfile({ tenantId, businessId, userId, payload }) {
    return this.updateUser({
      tenantId,
      businessId,
      userId,
      payload: {
        ...payload,
        profile_required: false,
      },
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
      defaults: ROLE_DEFAULT_PERMISSIONS,
    };
  }

  async updateUserPermissions({ tenantId, businessId, userId, permissions }) {
    return this.updateUser({
      tenantId,
      businessId,
      userId,
      payload: { permissions: permissions || [] },
    });
  }

  async assignUserOutlets({ tenantId, businessId, userId, outletIds }) {
    return this.updateUser({
      tenantId,
      businessId,
      userId,
      payload: { assigned_outlet_ids: outletIds || [] },
    });
  }
}

export const usersService = new UsersService();

