import { authService } from "../../core/auth/auth.service.js";
import env from "../../config/env.js";
import prisma from "../../database/prisma/client.js";
import { getSessionIdFromRequest } from "../../core/auth/auth-session.js";
import { ROLE_DEFAULT_PERMISSIONS } from "../constants/access.constants.js";
import { createHttpError } from "../utils/http-error.js";

const normalizeAccessValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^system[\s_-]+owner$/, "owner")
    .replace(/[\s_-]+/g, "");

const getBearerToken = (authorization = "") => {
  const [scheme, token] = String(authorization || "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : "";
};

const getAdminCoreBridgeApiKey = (req) =>
  req.get("x-admincore-api-key") ||
  req.get("x-pos-core-api-key") ||
  req.get("x-pos-bridge-key") ||
  req.get("x-api-key") ||
  getBearerToken(req.get("authorization"));

export const isAdminCoreBridgeRequest = (req) => {
  const bridgeKey = env.admincore.apiKey;
  if (!env.admincore.enabled || !bridgeKey) {
    return false;
  }
  const candidate = getAdminCoreBridgeApiKey(req);
  return candidate === bridgeKey;
};

const isAdminCoreSyncBridgePath = (req) =>
  req.path.startsWith("/sync/export/") || req.path === "/sync/logs/admincore";

const bridgeScopeFromHeaders = (req) => {
  const tenantId =
    req.headers["x-tenant-id"] ||
    req.headers["x-admincore-tenant-id"] ||
    req.headers.tenant_id ||
    req.headers.tenantid ||
    req.query.tenant_id ||
    req.query.tenantId;
  const businessId =
    req.headers["x-business-id"] ||
    req.headers["x-admincore-business-id"] ||
    req.headers.business_id ||
    req.headers.businessid ||
    req.query.business_id ||
    req.query.businessId;
  if (!tenantId && !businessId) {
    return null;
  }
  return {
    tenantId: tenantId ? String(tenantId) : null,
    businessId: businessId ? String(businessId) : null,
  };
};

const createAdminCoreBridgeUser = () => ({
  id: "admincore-bridge",
  name: "AdminCore Bridge",
  email: "admincore-bridge@system.local",
  role: "Owner",
  permissions: ROLE_DEFAULT_PERMISSIONS.Owner,
  active: true,
  isServiceAccount: true,
});

const resolveRequestContext = async (req, user) => {
  const requestedScope = bridgeScopeFromHeaders(req);
  const isBridgeRequest = isAdminCoreBridgeRequest(req);
  if (!requestedScope && isBridgeRequest) {
    return {
      tenantId: req.context?.tenantId || env.defaultTenantId,
      businessId: req.context?.businessId || env.defaultBusinessId,
    };
  }

  if (!requestedScope || !isBridgeRequest) {
    return {
      tenantId: user.tenantId,
      businessId: user.business_id,
    };
  }

  const business = await prisma.business.findFirst({
    where: {
      id: requestedScope.businessId || undefined,
      tenantId: requestedScope.tenantId || undefined,
    },
    select: { id: true, tenantId: true },
  });

  if (!business) {
    throw createHttpError({ statusCode: 403, message: "Forbidden: requested AdminCore business scope is invalid" });
  }

  return {
    tenantId: business.tenantId,
    businessId: business.id,
  };
};

const bindRequestContextToUser = async (req, user) => {
  const scopedContext = await resolveRequestContext(req, user);
  req.user = user;
  req.context = {
    ...(req.context || {}),
    ...scopedContext,
  };
};

export const bindAdminCoreBridgeRequest = async (req) => {
  await bindRequestContextToUser(req, createAdminCoreBridgeUser());
};

const getEffectivePermissions = (user) => {
  const roleName = user?.role || "";
  const storedPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const roleDefaults = ROLE_DEFAULT_PERMISSIONS[roleName] || [];

  return [...new Set([...storedPermissions, ...roleDefaults])];
};

export const requireAuth = async (req, res, next) => {
  try {
    const user = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });

    if (!user) {
      return next(createHttpError({ statusCode: 401, message: "Authentication required" }));
    }

    await bindRequestContextToUser(req, user);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireRole = (...allowedRoles) => async (req, res, next) => {
  try {
    const user = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });

    if (!user) {
      return next(createHttpError({ statusCode: 401, message: "Authentication required" }));
    }

    const normalizedAllowedRoles = allowedRoles.map(normalizeAccessValue);
    const normalizedUserRole = normalizeAccessValue(user.role);

    if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
      return next(createHttpError({ statusCode: 403, message: "Forbidden: insufficient role" }));
    }

    await bindRequestContextToUser(req, user);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireAdminCoreBridgeOrRole = (...allowedRoles) => async (req, res, next) => {
  try {
    if (isAdminCoreBridgeRequest(req)) {
      await bindAdminCoreBridgeRequest(req);
      return next();
    }

    return requireRole(...allowedRoles)(req, res, next);
  } catch (error) {
    return next(error);
  }
};

export const requirePermission = (...requiredPermissions) => async (req, res, next) => {
  try {
    const user = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });

    if (!user) {
      return next(createHttpError({ statusCode: 401, message: "Authentication required" }));
    }

    const permissions = getEffectivePermissions(user);
    const hasAllRequired = requiredPermissions.every((permission) => permissions.includes(permission));

    if (!hasAllRequired) {
      return next(createHttpError({ statusCode: 403, message: "Forbidden: insufficient permissions" }));
    }

    await bindRequestContextToUser(req, user);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const requireAnyPermission = (...allowedPermissions) => async (req, res, next) => {
  try {
    const user = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });

    if (!user) {
      return next(createHttpError({ statusCode: 401, message: "Authentication required" }));
    }

    const permissions = getEffectivePermissions(user);
    const hasAllowedPermission = allowedPermissions.some((permission) => permissions.includes(permission));

    if (!hasAllowedPermission) {
      return next(createHttpError({ statusCode: 403, message: "Forbidden: insufficient permissions" }));
    }

    await bindRequestContextToUser(req, user);
    return next();
  } catch (error) {
    return next(error);
  }
};
const PUBLIC_API_PREFIXES = [
  "/auth",
  "/public",
  "/feedback/form",
  "/admincore",
  "/payments/public",
  "/payments/webhooks",
  "/printer/agent",
];

export const requireApiSession = async (req, res, next) => {
  try {
    if (PUBLIC_API_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      return next();
    }

    if (isAdminCoreSyncBridgePath(req) && isAdminCoreBridgeRequest(req)) {
      await bindAdminCoreBridgeRequest(req);
      return next();
    }

    const user = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });

    if (!user) {
      return next(createHttpError({ statusCode: 401, message: "Authentication required" }));
    }

    await bindRequestContextToUser(req, user);
    return next();
  } catch (error) {
    return next(error);
  }
};

