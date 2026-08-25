import { authService } from "../../core/auth/auth.service.js";
import { getSessionIdFromRequest } from "../../core/auth/auth-session.js";
import { ROLE_DEFAULT_PERMISSIONS } from "../constants/access.constants.js";
import { createHttpError } from "../utils/http-error.js";

const bindRequestContextToUser = (req, user) => {
  req.user = user;
  req.context = {
    ...(req.context || {}),
    tenantId: user.tenantId,
    businessId: user.business_id,
  };
};

const normalizeAccessValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^system[\s_-]+owner$/, "owner")
    .replace(/[\s_-]+/g, "");

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

    bindRequestContextToUser(req, user);
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

    bindRequestContextToUser(req, user);
    return next();
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

    bindRequestContextToUser(req, user);
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

    bindRequestContextToUser(req, user);
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

    const user = await authService.getCurrentUser({
      sessionId: getSessionIdFromRequest(req),
    });

    if (!user) {
      return next(createHttpError({ statusCode: 401, message: "Authentication required" }));
    }

    bindRequestContextToUser(req, user);
    return next();
  } catch (error) {
    return next(error);
  }
};

