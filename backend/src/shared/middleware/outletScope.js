import { createHttpError } from "../utils/http-error.js";

/**
 * Outlet-level access.
 *
 * Owners, Managers and service accounts (AdminCore) work across every outlet of their business. Any other staff
 * member who has been assigned to specific outlets is limited to those outlets. Staff with no outlet assignment
 * keep business-wide access, which is how single-outlet businesses and older accounts already work.
 */
const UNRESTRICTED_ROLES = new Set(["owner", "manager"]);
const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase()
    .replace(/^system[\s_-]+owner$/, "owner");

// Request fields that name an outlet the caller wants to act on or read from.
const OUTLET_FIELDS = [
  "outlet_id",
  "outletId",
  "source_outlet_id",
  "sourceOutletId",
  "destination_outlet_id",
  "destinationOutletId",
];

export const outletScopeFor = (user) => {
  if (!user || user.isServiceAccount || UNRESTRICTED_ROLES.has(normalizeRole(user.role))) return null;
  const assigned = Array.isArray(user.assigned_outlet_ids) ? user.assigned_outlet_ids.filter(Boolean).map(String) : [];
  return assigned.length ? assigned : null;
};

export const isOutletAllowed = (req, outletId) => {
  const scope = req.context?.outletScope;
  if (!scope) return true;
  return Boolean(outletId) && scope.includes(String(outletId));
};

export const assertOutletAllowed = (req, outletId) => {
  if (!isOutletAllowed(req, outletId)) {
    throw createHttpError({ statusCode: 403, code: "OUTLET_ACCESS_DENIED", message: "You do not have access to this outlet" });
  }
};

export const filterByOutletScope = (req, rows, getOutletId) => {
  const scope = req.context?.outletScope;
  if (!scope || !Array.isArray(rows)) return rows;
  return rows.filter((row) => {
    const outletId = getOutletId(row);
    return Boolean(outletId) && scope.includes(String(outletId));
  });
};

/** Checks every outlet a request names in its query string or body. */
export const assertRequestOutlets = (req) => {
  const scope = req.context?.outletScope;
  if (!scope) return;
  const sources = [req.query || {}, req.body && typeof req.body === "object" ? req.body : {}];
  for (const source of sources) {
    for (const field of OUTLET_FIELDS) {
      const value = source[field];
      if (value === undefined || value === null || value === "") continue;
      assertOutletAllowed(req, value);
    }
  }
};

/** Express `router.param` handler for routes addressed by outlet id. */
export const outletParamGuard = (req, _res, next, outletId) => {
  try {
    assertOutletAllowed(req, outletId);
    next();
  } catch (error) {
    next(error);
  }
};
