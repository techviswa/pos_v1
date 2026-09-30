import prisma from "./client.js";
import { createHttpError } from "../../shared/utils/http-error.js";

const MODELS = {
  outlet: { delegate: "outlet", label: "outlet" },
  user: { delegate: "user", label: "user" },
  area: { delegate: "diningArea", label: "dining area" },
  routePlan: { delegate: "routePlan", label: "route plan" },
  purchaseOrder: { delegate: "purchaseOrder", label: "purchase order" },
  product: { delegate: "product", label: "product" },
};

/**
 * Every id a client sends that points at another record must belong to the caller's business.
 * Without this, a body like {"outletId": "<someone else's outlet>"} links (and can leak) another tenant's data.
 * Returns the de-duplicated ids; throws 400 when any id is unknown or foreign.
 */
export const assertOwnedIds = async ({ kind, ids, businessId, client = prisma }) => {
  const spec = MODELS[kind];
  if (!spec) throw new Error(`Unknown scope kind '${kind}'`);
  const wanted = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((id) => id !== undefined && id !== null && id !== "").map(String))];
  if (!wanted.length) return [];
  const found = await client[spec.delegate].count({ where: { id: { in: wanted }, businessId } });
  if (found !== wanted.length) {
    throw createHttpError({
      statusCode: 400,
      code: "REFERENCE_NOT_IN_BUSINESS",
      message: `One or more ${spec.label} references do not belong to this business`,
    });
  }
  return wanted;
};
