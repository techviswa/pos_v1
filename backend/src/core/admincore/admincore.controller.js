import { sendRawResponse } from "../../shared/utils/apiResponse.js";
import {
  checkAdmincoreHealth,
  getAdmincoreConnection,
  recordAdmincoreSyncStatus,
} from "./admincore.service.js";
import { saasService } from "../saas/saas.service.js";

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
