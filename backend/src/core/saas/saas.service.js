import env from "../../config/env.js";
import prisma from "../../database/prisma/client.js";
import {
  ensureBusiness,
  ensureRole,
  serializeBill,
  serializeBusiness,
  serializeInventoryItem,
  serializeOrder,
  serializeOutlet,
  serializeProduct,
  serializeUser,
  syncUserOutlets,
} from "../../database/prisma/helpers.js";
import { createHttpError, createNotFoundError } from "../../shared/utils/http-error.js";
import { featureToggleService } from "../../services/featureToggleService.js";
import { ACTIVE_SUBSCRIPTION_STATUSES, DEFAULT_SAAS_PLAN, getPlan, SAAS_PLANS } from "./saas-plans.js";
import { saasStore } from "./saas-store.js";

const normalizeId = (value, fallback) => String(value || fallback).trim();

const limitStatus = (used, limit) => ({
  used,
  limit,
  remaining: limit === null ? null : Math.max(Number(limit || 0) - Number(used || 0), 0),
  exceeded: limit !== null && Number(used || 0) > Number(limit || 0),
});

const buildDefaultConfig = (business) => {
  const plan = getPlan(DEFAULT_SAAS_PLAN);
  return {
    admincore_client_id: null,
    business_id: business.id,
    tenant_id: business.tenantId,
    plan: plan.key,
    subscription_status: "trialing",
    billing_status: "trialing",
    billing_customer_id: null,
    current_period_end: null,
    custom_domain: null,
    public_qr_domain: null,
    limits: plan.limits,
    enabled_features: plan.features,
    onboarded_at: business.createdAt ? business.createdAt.toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
};

class SaasService {
  async getBusinessOrThrow(businessId) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        users: {
          include: {
            business: true,
            role: true,
            permissions: { include: { permission: true } },
            outletAssignments: true,
          },
        },
        outlets: { include: { business: true } },
      },
    });
    if (!business) throw createNotFoundError("Business", { businessId });
    return business;
  }

  async getConfigForBusiness(business) {
    return {
      ...buildDefaultConfig(business),
      ...((await saasStore.getBusinessConfig(business.id)) || {}),
      business_id: business.id,
      tenant_id: business.tenantId,
    };
  }

  async listPlans() {
    return Object.values(SAAS_PLANS);
  }

  async getTenantOverview({ businessId }) {
    const business = await this.getBusinessOrThrow(normalizeId(businessId, env.defaultBusinessId));
    const [config, usage] = await Promise.all([this.getConfigForBusiness(business), this.getUsage({ businessId: business.id })]);
    const plan = getPlan(config.plan);

    return {
      business: serializeBusiness(business),
      admincore_role: "super_admin_source_of_truth",
      pos_role: "tenant_business_app",
      plan: { ...plan, limits: config.limits || plan.limits },
      subscription: {
        status: config.subscription_status,
        billing_status: config.billing_status,
        billing_customer_id: config.billing_customer_id,
        current_period_end: config.current_period_end,
        active: ACTIVE_SUBSCRIPTION_STATUSES.has(config.subscription_status),
      },
      domains: {
        custom_domain: config.custom_domain,
        public_qr_domain: config.public_qr_domain,
      },
      usage,
      enabled_features: config.enabled_features || plan.features,
      limits_enforced: true,
      onboarding: {
        admincore_client_id: config.admincore_client_id,
        onboarded_at: config.onboarded_at,
        updated_at: config.updated_at,
      },
    };
  }

  async upsertTenantFromAdminCore(payload = {}) {
    const businessId = normalizeId(payload.business_id || payload.businessId, env.defaultBusinessId);
    const tenantId = normalizeId(payload.tenant_id || payload.tenantId, `${businessId}-tenant`);
    const plan = getPlan(payload.plan);
    const business = await ensureBusiness({ businessId, tenantId });
    const updatedBusiness = await prisma.business.update({
      where: { id: business.id },
      data: { name: payload.name || payload.business_name || business.name },
    });
    const current = await this.getConfigForBusiness(updatedBusiness);
    const nextConfig = await saasStore.saveBusinessConfig(updatedBusiness.id, {
      ...current,
      admincore_client_id: payload.admincore_client_id || payload.client_id || current.admincore_client_id,
      plan: plan.key,
      subscription_status: payload.subscription_status || current.subscription_status || "trialing",
      billing_status: payload.billing_status || payload.subscription_status || current.billing_status || "trialing",
      billing_customer_id: payload.billing_customer_id || current.billing_customer_id,
      current_period_end: payload.current_period_end || current.current_period_end,
      custom_domain: payload.custom_domain ?? current.custom_domain,
      public_qr_domain: payload.public_qr_domain ?? current.public_qr_domain,
      limits: { ...plan.limits, ...(payload.limits || {}) },
      enabled_features: payload.enabled_features || payload.features || plan.features,
      onboarded_at: current.onboarded_at || new Date().toISOString(),
    });
    await featureToggleService.setFeaturesForBusiness(updatedBusiness.id, nextConfig.enabled_features);
    if (payload.owner_email && payload.owner_password) {
      await this.ensureOwnerUser({
        businessId: updatedBusiness.id,
        name: payload.owner_name || "Business Owner",
        email: payload.owner_email,
        password: payload.owner_password,
      });
    }
    return this.getTenantOverview({ businessId: updatedBusiness.id });
  }

  async ensureOwnerUser({ businessId, name, email, password }) {
    const role = await ensureRole("Owner");
    const user = await prisma.user.upsert({
      where: { businessId_email: { businessId, email } },
      update: { name, passwordHash: password, roleId: role.id, active: true, profileRequired: false },
      create: { businessId, roleId: role.id, name, email, passwordHash: password, active: true, profileRequired: false },
    });
    const outlet = await prisma.outlet.findFirst({ where: { businessId } });
    if (outlet) await syncUserOutlets(user.id, [outlet.id]);
    return user;
  }

  async updateSubscription({ businessId, payload = {} }) {
    const business = await this.getBusinessOrThrow(normalizeId(businessId, env.defaultBusinessId));
    const current = await this.getConfigForBusiness(business);
    const plan = getPlan(payload.plan || current.plan);
    await saasStore.saveBusinessConfig(business.id, {
      ...current,
      plan: plan.key,
      subscription_status: payload.subscription_status || current.subscription_status,
      billing_status: payload.billing_status || payload.subscription_status || current.billing_status,
      billing_customer_id: payload.billing_customer_id ?? current.billing_customer_id,
      current_period_end: payload.current_period_end ?? current.current_period_end,
      limits: payload.limits ? { ...plan.limits, ...payload.limits } : plan.limits,
      enabled_features: payload.enabled_features || payload.features || current.enabled_features || plan.features,
    });
    return this.getTenantOverview({ businessId: business.id });
  }

  async updateDomains({ businessId, payload = {} }) {
    const business = await this.getBusinessOrThrow(normalizeId(businessId, env.defaultBusinessId));
    const current = await this.getConfigForBusiness(business);
    await saasStore.saveBusinessConfig(business.id, {
      ...current,
      custom_domain: payload.custom_domain ?? current.custom_domain,
      public_qr_domain: payload.public_qr_domain ?? current.public_qr_domain,
    });
    return this.getTenantOverview({ businessId: business.id });
  }

  async getUsage({ businessId }) {
    const targetBusinessId = normalizeId(businessId, env.defaultBusinessId);
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const [business, outlets, staff, products, qrTables, monthlyOrders, bills, inventoryItems] = await Promise.all([
      prisma.business.findUnique({ where: { id: targetBusinessId } }),
      prisma.outlet.count({ where: { businessId: targetBusinessId } }),
      prisma.user.count({ where: { businessId: targetBusinessId, active: true } }),
      prisma.product.count({ where: { businessId: targetBusinessId, active: true } }),
      prisma.tableQrCode.count({ where: { businessId: targetBusinessId, active: true } }),
      prisma.order.count({ where: { businessId: targetBusinessId, createdAt: { gte: startOfMonth } } }),
      prisma.bill.count({ where: { businessId: targetBusinessId } }),
      prisma.inventoryItem.count({ where: { businessId: targetBusinessId } }),
    ]);
    if (!business) throw createNotFoundError("Business", { businessId: targetBusinessId });
    const config = await this.getConfigForBusiness(business);
    const limits = config.limits || getPlan(config.plan).limits;
    return {
      business_id: targetBusinessId,
      period: { month_start: startOfMonth.toISOString() },
      limits: {
        outlets: limitStatus(outlets, limits.outlets),
        staff: limitStatus(staff, limits.staff),
        products: limitStatus(products, limits.products),
        qr_tables: limitStatus(qrTables, limits.qr_tables),
        monthly_orders: limitStatus(monthlyOrders, limits.monthly_orders),
      },
      raw_counts: { outlets, staff, products, qr_tables: qrTables, monthly_orders: monthlyOrders, bills, inventory_items: inventoryItems },
    };
  }

  async assertWithinLimit({ businessId, resource, increment = 1 }) {
    const usage = await this.getUsage({ businessId });
    const limit = usage.limits[resource];
    if (limit?.limit !== null && limit?.used + increment > limit.limit) {
      throw createHttpError({
        statusCode: 402,
        code: "PLAN_LIMIT_EXCEEDED",
        message: `Plan limit exceeded for ${resource}`,
        details: { business_id: businessId, resource, used: limit.used, limit: limit.limit },
      });
    }
  }

  async exportTenant({ businessId }) {
    const targetBusinessId = normalizeId(businessId, env.defaultBusinessId);
    const business = await this.getBusinessOrThrow(targetBusinessId);
    const [config, products, orders, bills, inventoryItems, tables] = await Promise.all([
      this.getConfigForBusiness(business),
      prisma.product.findMany({ where: { businessId: targetBusinessId }, include: { business: true, variations: true, addons: true } }),
      prisma.order.findMany({ where: { businessId: targetBusinessId }, include: { business: true, items: true } }),
      prisma.bill.findMany({ where: { businessId: targetBusinessId }, include: { business: true, items: true } }),
      prisma.inventoryItem.findMany({ where: { businessId: targetBusinessId }, include: { business: true } }),
      prisma.diningTable.findMany({ where: { businessId: targetBusinessId } }),
    ]);
    return {
      exported_at: new Date().toISOString(),
      business: serializeBusiness(business),
      saas: config,
      users: business.users.map(serializeUser),
      outlets: business.outlets.map(serializeOutlet),
      products: products.map(serializeProduct),
      orders: orders.map(serializeOrder),
      bills: bills.map(serializeBill),
      inventory: inventoryItems.map(serializeInventoryItem),
      tables,
    };
  }
}

export const saasService = new SaasService();
