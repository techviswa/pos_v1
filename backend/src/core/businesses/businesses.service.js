import prisma from "../../database/prisma/client.js";
import { serializeBusiness } from "../../database/prisma/helpers.js";
import { createHttpError, createNotFoundError } from "../../shared/utils/http-error.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

const getBusinessInclude = () => ({
  users: {
    select: {
      id: true,
    },
  },
  outlets: {
    select: {
      id: true,
    },
  },
});

class BusinessesService {
  async upsertBusiness({ payload }) {
    const businessId = String(payload.id || payload.business_id || payload.businessId || `pos-${Date.now()}`);
    const tenantId = String(payload.tenantId || payload.tenant_id || `${businessId}-tenant`);
    const name = payload.name || payload.business_name || "POS Business";

    const business = await prisma.business.upsert({
      where: { tenantId },
      update: { name },
      create: {
        id: businessId,
        tenantId,
        name,
      },
      include: getBusinessInclude(),
    });

    const serializedBusiness = serializeBusiness(business);
    await admincoreChangeSyncService.notifyChange({
      resource: "businesses",
      action: "upserted",
      recordId: serializedBusiness.id,
      tenantId: serializedBusiness.tenant_id,
      businessId: serializedBusiness.id,
      metadata: {
        name: serializedBusiness.name,
        status: serializedBusiness.status,
        plan: serializedBusiness.plan,
      },
    });

    return serializedBusiness;
  }
  async renameBusiness({ businessId, name }) {
    const trimmed = String(name || "").trim();
    if (!trimmed) throw createHttpError({ statusCode: 400, code: "BUSINESS_NAME_REQUIRED", message: "name is required" });
    if (trimmed.length > 120) throw createHttpError({ statusCode: 400, code: "BUSINESS_NAME_TOO_LONG", message: "name must be at most 120 characters" });
    const business = await prisma.business.update({ where: { id: String(businessId) }, data: { name: trimmed }, include: getBusinessInclude() });
    const serialized = serializeBusiness(business);
    await admincoreChangeSyncService.notifyChange({
      resource: "businesses",
      action: "updated",
      recordId: serialized.id,
      tenantId: serialized.tenant_id,
      businessId: serialized.id,
      metadata: { name: serialized.name, status: serialized.status, plan: serialized.plan },
    });
    return serialized;
  }

  async listBusinesses({ businessId } = {}) {
    const businesses = await prisma.business.findMany({
      where: businessId ? { id: String(businessId) } : {},
      orderBy: { createdAt: "asc" },
      include: getBusinessInclude(),
    });

    return businesses.map(serializeBusiness);
  }

  async getBusinessById({ businessId, currentBusinessId }) {
    const business = await prisma.business.findUnique({
      where: { id: String(businessId) },
      include: getBusinessInclude(),
    });

    if (!business) {
      throw createNotFoundError("Business", { businessId });
    }

    if (currentBusinessId && business.id !== String(currentBusinessId)) {
      throw createHttpError({ statusCode: 403, message: "Forbidden: business access denied" });
    }

    return serializeBusiness(business);
  }
}

export const businessesService = new BusinessesService();


