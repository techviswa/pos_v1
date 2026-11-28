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
import { authorizeBridgeActor } from './bridge-actor.js';
import { readOperationalReceipt } from '../../shared/utils/operational-write.js';

const bridgeWriteAuthority = async (req, context, resource, kind) => {
  const commandId = req.body?.admincore_command_id || req.body?.request_id;
  const receipt = kind && commandId ? await readOperationalReceipt({
    businessId: context.businessId, kind, payload: { ...req.body, request_id: commandId },
  }) : null;
  if (receipt) return { receipt };
  return { actor: await authorizeBridgeActor(req, { ...context, resource }) };
};

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
  const authority = await bridgeWriteAuthority(req, { businessId, tenantId }, 'staff', 'staff-create');
  if (authority.receipt) return sendRawResponse(res, { statusCode: 201, data: authority.receipt });
  const data = await usersService.createUser({
    tenantId,
    businessId,
    payload: req.body,
    actor: authority.actor,
    rejectExisting: Boolean(req.body.admincore_command_id),
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
  const authority = await bridgeWriteAuthority(req, { businessId, tenantId }, 'staff', `staff-update:${req.params.userId}`);
  if (authority.receipt) return sendRawResponse(res, { data: authority.receipt });
  const data = await usersService.updateUser({ businessId, tenantId, userId: req.params.userId, payload: req.body, actor: authority.actor });
  sendRawResponse(res, { data });
};

export const postBridgeProduct = async (req, res) => {
  const { businessId, tenantId } = await getBridgeProductContext(req);
  const authority = await bridgeWriteAuthority(req, { businessId, tenantId }, 'products', 'product-create');
  if (authority.receipt) return sendRawResponse(res, { statusCode: 201, data: await productsService.getProductById({ tenantId, productId: authority.receipt.id }) });
  const sourceProductId = req.body.admincore_product_id || null;
  if (sourceProductId && !/^acp_[a-f0-9]{32}$/.test(sourceProductId)) throw createHttpError({ statusCode: 400, message: "Invalid AdminCore product identity" });
  const data = await productsService.createProduct({
    tenantId,
    payload: req.body,
    sourceProductId,
    commandId: req.body.admincore_command_id || null,
  });
  sendRawResponse(res, { statusCode: 201, data });
};

export const putBridgeProduct = async (req, res) => {
  const { businessId, tenantId } = await getBridgeProductContext(req);
  const authority = await bridgeWriteAuthority(req, { businessId, tenantId }, 'products', 'product-update');
  if (authority.receipt) return sendRawResponse(res, { data: await productsService.getProductById({ tenantId, productId: req.params.productId }) });
  if (req.body.expected_updated_at && !Number.isFinite(Date.parse(req.body.expected_updated_at))) throw createHttpError({ statusCode: 400, message: "Invalid expected product version" });
  const data = await productsService.updateProduct({
    tenantId,
    productId: req.params.productId,
    payload: req.body,
    commandId: req.body.admincore_command_id || null,
    expectedUpdatedAt: req.body.expected_updated_at || null,
  });
  sendRawResponse(res, { data });
};

const outletCommand = req => {
  const sourceOutletId = req.body?.admincore_outlet_id || null;
  const commandId = req.body?.admincore_command_id || (req.method === "POST" ? sourceOutletId : null);
  const expectedUpdatedAt = req.body?.expected_updated_at || null;
  if (sourceOutletId && !/^aco_[a-f0-9]{32}$/.test(sourceOutletId)) throw createHttpError({ statusCode: 400, message: "Invalid AdminCore outlet identity" });
  if (commandId && !/^[a-zA-Z0-9_-]{8,100}$/.test(commandId)) throw createHttpError({ statusCode: 400, message: "Invalid outlet command identifier" });
  if (expectedUpdatedAt && !Number.isFinite(Date.parse(expectedUpdatedAt))) throw createHttpError({ statusCode: 400, message: "Invalid expected outlet version" });
  if (commandId && ["PUT", "DELETE"].includes(req.method) && !expectedUpdatedAt) throw createHttpError({ statusCode: 400, message: "A source outlet version is required for this command" });
  return { sourceOutletId, commandId, expectedUpdatedAt };
};

export const postBridgeOutlet = async (req, res) => {
  const { businessId, tenantId } = await getBridgeTenantContext(req, "OUTLET");
  const authority = await bridgeWriteAuthority(req, { businessId, tenantId }, 'outlets', 'outlet-create');
  if (authority.receipt) return sendRawResponse(res, { statusCode: 201, data: await outletsService.getOutletById({ tenantId, outletId: authority.receipt.id }) });
  const data = await outletsService.createOutlet({
    tenantId,
    payload: req.body,
    ...outletCommand(req),
  });
  sendRawResponse(res, { statusCode: 201, data });
};

export const putBridgeOutlet = async (req, res) => {
  const { businessId, tenantId } = await getBridgeTenantContext(req, "OUTLET");
  const authority = await bridgeWriteAuthority(req, { businessId, tenantId }, 'outlets', `outlet-update:${req.params.outletId}`);
  if (authority.receipt) return sendRawResponse(res, { data: await outletsService.getOutletById({ tenantId, outletId: req.params.outletId }) });
  const data = await outletsService.updateOutlet({
    tenantId,
    outletId: req.params.outletId,
    payload: req.body,
    ...outletCommand(req),
  });
  sendRawResponse(res, { data });
};

export const deleteBridgeOutlet = async (req, res) => {
  const { businessId, tenantId } = await getBridgeTenantContext(req, "OUTLET");
  await authorizeBridgeActor(req, { businessId, tenantId, resource: 'outlets' });

  const data = await outletsService.deleteOutlet({
    tenantId,
    outletId: req.params.outletId,
    ...outletCommand(req),
  });
  sendRawResponse(res, { data });
};

export const deleteBridgeProduct = async (req, res) => {
  if (req.body?.expected_updated_at && !Number.isFinite(Date.parse(req.body.expected_updated_at))) throw createHttpError({ statusCode: 400, message: "Invalid expected product version" });
  const { businessId, tenantId } = await getBridgeProductContext(req);
  await authorizeBridgeActor(req, { businessId, tenantId, resource: 'products' });

  const data = await productsService.deleteProduct({
    tenantId,
    productId: req.params.productId,
    expectedUpdatedAt: req.body?.expected_updated_at || null,
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
  // Streamed: a large business's history is written in pieces instead of built in memory first.
  res.status(200).type("application/json");
  const write = (chunk) => (res.write(chunk) ? undefined : new Promise((resolve) => res.once("drain", resolve)));
  await saasService.streamTenantExport({ businessId: req.params.businessId, write });
  res.end();
};
