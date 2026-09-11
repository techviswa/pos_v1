import env from "../../config/env.js";
import { isDatabaseAvailable } from "../../config/db.js";
import prisma from "../../database/prisma/client.js";
import {
  ensureAccessControlSeed,
  ensureBusiness,
  ensureRole,
  ensurePermissions,
  serializeUser,
  syncUserOutlets,
} from "../../database/prisma/helpers.js";
import { userSeedData } from "../../shared/data/core-seed-data.js";
import { createAuthToken, consumeAuthToken, getAuthToken } from "./auth-tokens.js";
import { createSessionId, SESSION_TTL_MS } from "./auth-session.js";
import { hashPassword, isPasswordHash, verifyPassword } from "./passwords.js";
import { sessions as sessionRecords } from "./session-store.js";
import { ROLE_DEFAULT_PERMISSIONS } from "../../shared/constants/access.constants.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { authMailer } from "./auth-mail.js";

let bootstrapUserPromise = null;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

class AuthService {
  shouldUseFallback(error) {
    return !isDatabaseAvailable() || error?.code === "P2021";
  }

  getFallbackUsers() {
    return userSeedData.map((user) => ({
      ...user,
      business_id: env.defaultBusinessId,
      tenantId: env.defaultTenantId,
    }));
  }

  getFallbackUserById(userId) {
    return this.getFallbackUsers().find((user) => user.id === userId) || null;
  }

  serializeFallbackUser(user) {
    return user
      ? {
          ...user,
          password: undefined,
        }
      : null;
  }

  async ensureBootstrapUser() {
    if (env.nodeEnv === "production") return null;
    if (!isDatabaseAvailable()) {
      if (env.nodeEnv === "production") {
        return null;
      }
      return this.getFallbackUsers()[0] || null;
    }

    if (!bootstrapUserPromise) {
      bootstrapUserPromise = (async () => {
        try {
          await ensureAccessControlSeed();
          const business = await ensureBusiness({
            tenantId: env.defaultTenantId,
            businessId: env.defaultBusinessId,
          });
          const role = await ensureRole("Owner");

          const existingBootstrapUser = await prisma.user.findUnique({
            where: {
              businessId_email: {
                businessId: business.id,
                email: env.auth.adminEmail,
              },
            },
            include: getUserInclude(),
          });

          const user = existingBootstrapUser
            ? await prisma.user.update({
                where: { id: existingBootstrapUser.id },
                data: {
                  roleId: role.id,
                  profileRequired: false,
                  active: true,
                  ...(!isPasswordHash(existingBootstrapUser.passwordHash)
                    ? { passwordHash: hashPassword(env.auth.adminPassword) }
                    : {}),
                },
                include: getUserInclude(),
              })
            : await prisma.user.create({
              data: {
              businessId: business.id,
              roleId: role.id,
              name: "System Owner",
              email: env.auth.adminEmail,
              passwordHash: hashPassword(env.auth.adminPassword),
              profileRequired: false,
              active: true,
            },
              include: getUserInclude(),
            });

          const outlet = await prisma.outlet.findFirst({
            where: { businessId: business.id },
          });

          if (outlet) {
            await syncUserOutlets(user.id, [outlet.id]);
          }

          return prisma.user.findUnique({
            where: { id: user.id },
            include: getUserInclude(),
          });
        } catch (error) {
          if (this.shouldUseFallback(error) && env.nodeEnv !== "production") {
            return this.getFallbackUsers()[0] || null;
          }

          bootstrapUserPromise = null;
          throw error;
        }
      })().catch((error) => {
        bootstrapUserPromise = null;
        throw error;
      });
    }

    return bootstrapUserPromise;
  }

  async createSessionForUser(userId) {
    const sessionId = createSessionId();
    const now = Date.now();
    await sessionRecords.set(sessionId, {
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastSeenAt: now,
    });
    return sessionId;
  }

  async resolveSessionUserId(sessionId) {
    if (!sessionId) {
      return null;
    }

    const record = await sessionRecords.get(String(sessionId));
    if (!record) {
      return null;
    }

    if (record.expiresAt <= Date.now()) {
      await sessionRecords.delete(String(sessionId));
      return null;
    }

    record.lastSeenAt = Date.now();
    return record.userId || null;
  }

  async refreshSessionRecord(sessionId) {
    const record = await sessionRecords.get(String(sessionId || ""));
    if (!record || record.expiresAt <= Date.now()) {
      if (sessionId) {
        await sessionRecords.delete(String(sessionId));
      }
      return false;
    }

    record.lastSeenAt = Date.now();
    record.expiresAt = Date.now() + SESSION_TTL_MS;
    await sessionRecords.set(String(sessionId), record);
    return true;
  }

  async findUserByEmail(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const matchingUsers = await prisma.user.findMany({
      where: { email: normalizedEmail },
      include: getUserInclude(),
    });
    return matchingUsers.find((entry) => entry.email.toLowerCase() === normalizedEmail) || null;
  }

  async verifyAndUpgradePassword(user, password) {
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return false;
    }

    if (!isPasswordHash(user.passwordHash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(password) },
      });
    }

    return true;
  }

  async login({ email, password }) {
    if (!isDatabaseAvailable() && env.nodeEnv !== "production") {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const user = this.getFallbackUsers().find(
        (entry) => entry.email.toLowerCase() === normalizedEmail && entry.password === password,
      );

      if (!user) {
        return null;
      }

      return {
        user: this.serializeFallbackUser(user),
        sessionId: await this.createSessionForUser(user.id),
      };
    }

    try {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      let user = await this.findUserByEmail(normalizedEmail);
      const passwordValid = await this.verifyAndUpgradePassword(user, password);

      if (!user || !passwordValid || user.email.toLowerCase() !== normalizedEmail || user.active === false) {
        return null;
      }

      if (env.nodeEnv !== "production" && normalizedEmail === String(env.auth.adminEmail || "").trim().toLowerCase()) {
        const ownerRole = await ensureRole("Owner");
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            roleId: ownerRole.id,
            profileRequired: false,
            active: true,
          },
          include: getUserInclude(),
        });
      }

      return {
        user: serializeUser(user),
        sessionId: await this.createSessionForUser(user.id),
      };
    } catch (error) {
      if (!this.shouldUseFallback(error) || env.nodeEnv === "production") {
        throw error;
      }

      const normalizedEmail = String(email || "").trim().toLowerCase();
      const user = this.getFallbackUsers().find(
        (entry) => entry.email.toLowerCase() === normalizedEmail && entry.password === password,
      );

      if (!user) {
        return null;
      }

      return {
        user: this.serializeFallbackUser(user),
        sessionId: await this.createSessionForUser(user.id),
      };
    }
  }

  async getCurrentUser({ sessionId } = {}) {
    try {
      const targetUserId = await this.resolveSessionUserId(sessionId);
      if (!targetUserId) {
        return null;
      }

      if (!isDatabaseAvailable() && env.nodeEnv !== "production") {
        const fallbackUser = this.getFallbackUserById(targetUserId);
        if (!fallbackUser) {
          return null;
        }

        return this.serializeFallbackUser(fallbackUser);
      }

      const user = await prisma.user.findUnique({
        where: { id: targetUserId },
        include: getUserInclude(),
      });

      return user && user.active ? serializeUser(user) : null;
    } catch (error) {
      if (!this.shouldUseFallback(error) || env.nodeEnv === "production") {
        throw error;
      }

      const fallbackUser = this.getFallbackUserById(await this.resolveSessionUserId(sessionId)) || null;
      return this.serializeFallbackUser(fallbackUser);
    }
  }

  async refreshSession({ sessionId } = {}) {
    if (!await this.refreshSessionRecord(sessionId)) {
      return null;
    }

    const user = await this.getCurrentUser({ sessionId });

    return user
      ? {
          ...user,
          refreshed_at: new Date().toISOString(),
        }
      : null;
  }

  async logout({ sessionId } = {}) {
    if (sessionId) {
      await sessionRecords.delete(String(sessionId));
    }

    return { loggedOut: true };
  }

  async requestPasswordReset({ email }) {
    if (env.nodeEnv === "production") authMailer.requireConfigured();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!isDatabaseAvailable()) {
      return { accepted: true };
    }

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return { accepted: true };
    }

    const user = await this.findUserByEmail(normalizedEmail);
    if (!user) {
      return { accepted: true };
    }

    const token = await createAuthToken({
      type: "password_reset",
      userId: user.id,
      ttlMs: PASSWORD_RESET_TTL_MS,
      metadata: {
        business_id: user.businessId,
        email: user.email,
      },
    });

    const response = {
      accepted: true,
      expires_in_minutes: PASSWORD_RESET_TTL_MS / 60000,
    };
    if (authMailer.configured()) await authMailer.send({ email: user.email, token, type: "password_reset" });
    if (env.nodeEnv !== "production") {
      response.reset_token = token;
    }
    return env.nodeEnv === "production" ? { accepted: true } : response;
  }

  async resetPassword({ token, password }) {
    if (String(password || "").length < 8) {
      return null;
    }

    const record = await consumeAuthToken({ token, type: "password_reset" });
    if (!record) {
      return null;
    }

    await prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: hashPassword(password),
        profileRequired: false,
      },
    });

    await prisma.authSession.deleteMany({ where: { userId: record.userId } });

    return { reset: true };
  }

  async createInvite({ businessId, email, role = "Cashier", invitedBy, actorRole }) {
    if (!Object.hasOwn(ROLE_DEFAULT_PERMISSIONS, role) || (role === "Owner" && actorRole !== "Owner")) {
      throw createHttpError({ statusCode: 403, message: "You cannot invite this role" });
    }
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return null;
    }

    const existing = await prisma.user.findUnique({ where: { businessId_email: { businessId, email: normalizedEmail } } });
    if (existing) throw createHttpError({ statusCode: 409, message: "This user already belongs to the business" });
    const token = await createAuthToken({
      type: "invite",
      userId: null,
      ttlMs: INVITE_TTL_MS,
      metadata: {
        business_id: businessId,
        email: normalizedEmail,
        role,
        invited_by: invitedBy || null,
      },
    });

    if (authMailer.configured()) await authMailer.send({ email: normalizedEmail, token, type: "invite" });
    return {
      invite_token: token,
      email: normalizedEmail,
      role,
      expires_in_days: INVITE_TTL_MS / (1000 * 60 * 60 * 24),
    };
  }

  async getInvite({ token }) {
    const record = await getAuthToken({ token, type: "invite" });
    return record
      ? {
          email: record.metadata.email,
          role: record.metadata.role,
          business_id: record.metadata.business_id,
          expires_at: new Date(record.expiresAt).toISOString(),
        }
      : null;
  }

  async acceptInvite({ token, name, password }) {
    if (String(password || "").length < 8) {
      return null;
    }

    const record = await consumeAuthToken({ token, type: "invite" });
    if (!record) {
      return null;
    }

    const businessId = record.metadata.business_id;
    if (!businessId) return null;
    const role = await ensureRole(record.metadata.role || "Cashier");
    const permissions = await ensurePermissions(ROLE_DEFAULT_PERMISSIONS[role.name] || []);
    let user;
    try {
      user = await prisma.user.create({
      data: {
        businessId,
        roleId: role.id,
        name: name || record.metadata.email,
        email: record.metadata.email,
        passwordHash: hashPassword(password),
        profileRequired: false,
        active: true,
        permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
      },
      include: getUserInclude(),
    });
    } catch (error) {
      if (error.code === "P2002") return null;
      throw error;
    }

    return serializeUser(user);
  }

  async getSessionInfo({ sessionId } = {}) {
    const user = await this.getCurrentUser({ sessionId });

    return {
      business_id: user?.business_id || env.defaultBusinessId,
      tenant_id: user?.tenantId || env.defaultTenantId,
      user,
      authenticated: Boolean(user),
      expires_at: user ? new Date((await sessionRecords.get(String(sessionId)))?.expiresAt).toISOString() : null,
    };
  }
}

export const authService = new AuthService();

