import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../utils/http-error.js";
import { assertOutletAllowed } from "./outletScope.js";

/**
 * `router.param` guards for records addressed by id. For outlet-restricted staff they load only the record's outlet
 * and refuse access when it is outside the caller's assigned outlets. Unknown ids fall through so the handler can
 * return its usual 404. Unrestricted callers pay no extra query.
 */
const guard = (loadOutletId) => async (req, _res, next, id) => {
  try {
    if (!req.context?.outletScope) return next();
    const outletId = await loadOutletId({ id: String(id), businessId: req.context.businessId });
    if (outletId === undefined) return next();
    assertOutletAllowed(req, outletId);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const invoiceOutletGuard = guard(async ({ id, businessId }) => {
  const bill = await prisma.bill.findFirst({
    where: { id, businessId },
    select: { metadata: true, order: { select: { outletId: true } } },
  });
  if (!bill) return undefined;
  return bill.metadata?.outlet_id || bill.order?.outletId || null;
});

export const orderOutletGuard = guard(async ({ id, businessId }) => {
  const order = await prisma.order.findFirst({ where: { id, businessId }, select: { outletId: true, metadata: true } });
  if (!order) return undefined;
  return order.outletId || order.metadata?.outlet_id || null;
});

export const ticketOutletGuard = guard(async ({ id, businessId }) => {
  const ticket = await prisma.kitchenTicket.findFirst({
    where: { id, businessId },
    select: { order: { select: { outletId: true, metadata: true } } },
  });
  if (!ticket) return undefined;
  return ticket.order?.outletId || ticket.order?.metadata?.outlet_id || null;
});

/**
 * New bills and orders from outlet-restricted staff always belong to one of their outlets: with a single outlet it
 * is filled in, with several the client must say which.
 */
export const applyDefaultOutlet = (req, _res, next) => {
  const scope = req.context?.outletScope;
  if (!scope || !req.body || typeof req.body !== "object") return next();
  if (req.body.outlet_id || req.body.outletId) return next();
  if (scope.length === 1) {
    req.body.outlet_id = scope[0];
    return next();
  }
  return next(createHttpError({ statusCode: 400, code: "OUTLET_REQUIRED", message: "Choose the outlet for this sale" }));
};

/** Reports and dashboards read one outlet at a time for outlet-restricted staff. */
export const scopeOutletQuery = (req, _res, next) => {
  const scope = req.context?.outletScope;
  if (!scope) return next();
  if (req.query?.outlet_id || req.query?.outletId) return next();
  if (scope.length === 1) {
    req.query.outlet_id = scope[0];
    return next();
  }
  return next(createHttpError({ statusCode: 400, code: "OUTLET_REQUIRED", message: "Choose one of your outlets to view this report" }));
};
