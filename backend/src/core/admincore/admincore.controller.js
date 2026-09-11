import { sendRawResponse } from "../../shared/utils/apiResponse.js";
import {
  checkAdmincoreHealth,
  getAdmincoreConnection,
  recordAdmincoreSyncStatus,
} from "./admincore.service.js";
import { saasService } from "../saas/saas.service.js";
import { usersService } from "../users/users.service.js";
import { productsService } from "../products/products.service.js";
import { outletsService } from "../outlets/outlets.service.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import prisma from "../../database/prisma/client.js";
import { resolveBridgeContext } from "./bridge-context.js";

const verifyBridgeBusiness = async (businessId, tenantId) => {
  const business = await prisma.business.findFirst({ where: { id: businessId, tenantId }, select: { id: true } });
  if (!business) {
    throw createHttpError({ statusCode: 403, code: "POS_TENANT_SCOPE_MISMATCH", message: "Business and tenant do not identify the same POS business" });
  }
};

export const getConnection = (_req, res) => {
  sendRawResponse(res, {
    data: getAdmincoreConnection(),
  });
};

export const getHealth = async (_req, res) => {
  const health = await checkAdmincoreHealth();

  sendRawResponse(res, {
    data: health,
  });
};

export const postSyncStatus = (req, res) => {
  const status = recordAdmincoreSyncStatus(req.body);

  sendRawResponse(res, {
    statusCode: 201,
    data: {
      accepted: true,
      status,
    },
  });
};

export const getSaasTenant = async (req, res) => {
  sendRawResponse(res, { data: await saasService.getTenantOverview({ businessId: req.params.businessId }) });
};

export const postSaasTenant = async (req, res) => {
  sendRawResponse(res, { statusCode: 201, data: await saasService.upsertTenantFromAdminCore(req.body) });
};

export const postBridgeStaff = async (req, res) => {
  const { businessId, tenantId } = resolveBridgeContext(req);
  if (!businessId || !tenantId) {
    throw createHttpError({
      statusCode: 400,
      code: "ADMINCORE_STAFF_PROVISIONING_CONTEXT_REQUIRED",
      message: "business_id and tenant_id are required for AdminCore staff provisioning",
    });
  }

  await verifyBridgeBusiness(businessId, tenantId);
  const data = await usersService.createUser({
    tenantId,
    businessId,
    payload: req.body,
  });
  sendRawResponse(res, { statusCode: 201, data });
};

const getBridgeProductContext = async (req) => {
  const { businessId, tenantId } = resolveBridgeContext(req);
  if (!businessId || !tenantId) {
    throw createHttpError({
      statusCode: 400,
      code: "ADMINCORE_PRODUCT_CONTEXT_REQUIRED",
      message: "business_id and tenant_id are required for AdminCore product provisioning",
    });
  }

  await verifyBridgeBusiness(businessId, tenantId);
  return { businessId, tenantId };
};

const getBridgeTenantContext = async (req, resourceLabel) => {
  const { businessId, tenantId } = resolveBridgeContext(req);
  if (!businessId || !tenantId) {
    throw createHttpError({
      statusCode: 400,
      code: `ADMINCORE_${resourceLabel}_CONTEXT_REQUIRED`,
      message: `business_id and tenant_id are required for AdminCore ${resourceLabel.toLowerCase()} provisioning`,
    });
  }

  await verifyBridgeBusiness(businessId, tenantId);
  return { businessId, tenantId };
};

export const putBridgeStaff = async (req, res) => {
  const { businessId, tenantId } = await getBridgeTenantContext(req, "STAFF");
  const data = await usersService.updateUser({ businessId, tenantId, userId: req.params.userId, payload: req.body });
  sendRawResponse(res, { data });
};

export const postBridgeProduct = async (req, res) => {
  const { tenantId } = await getBridgeProductContext(req);
  const data = await productsService.createProduct({
    tenantId,
    payload: req.body,
  });
  sendRawResponse(res, { statusCode: 201, data });
};

export const putBridgeProduct = async (req, res) => {
  const { tenantId } = await getBridgeProductContext(req);
  const data = await productsService.updateProduct({
    tenantId,
    productId: req.params.productId,
    payload: req.body,
  });
  sendRawResponse(res, { data });
};

export const postBridgeOutlet = async (req, res) => {
  const { tenantId } = await getBridgeTenantContext(req, "OUTLET");
  const data = await outletsService.createOutlet({
    tenantId,
    payload: req.body,
  });
  sendRawResponse(res, { statusCode: 201, data });
};

export const putBridgeOutlet = async (req, res) => {
  const { tenantId } = await getBridgeTenantContext(req, "OUTLET");
  const data = await outletsService.updateOutlet({
    tenantId,
    outletId: req.params.outletId,
    payload: req.body,
  });
  sendRawResponse(res, { data });
};

export const deleteBridgeOutlet = async (req, res) => {
  const { tenantId } = await getBridgeTenantContext(req, "OUTLET");

  const data = await outletsService.deleteOutlet({
    tenantId,
    outletId: req.params.outletId,
  });
  sendRawResponse(res, { data });
};

export const deleteBridgeProduct = async (req, res) => {
  const { tenantId } = await getBridgeProductContext(req);

  const data = await productsService.deleteProduct({
    tenantId,
    productId: req.params.productId,
  });
  sendRawResponse(res, { data });
};

export const putSaasSubscription = async (req, res) => {
  sendRawResponse(res, {
    data: await saasService.updateSubscription({
      businessId: req.params.businessId,
      payload: req.body,
    }),
  });
};

export const putSaasDomains = async (req, res) => {
  sendRawResponse(res, {
    data: await saasService.updateDomains({
      businessId: req.params.businessId,
      payload: req.body,
    }),
  });
};

export const getSaasUsage = async (req, res) => {
  sendRawResponse(res, { data: await saasService.getUsage({ businessId: req.params.businessId }) });
};

export const getSaasExport = async (req, res) => {
  sendRawResponse(res, { data: await saasService.exportTenant({ businessId: req.params.businessId }) });
};
