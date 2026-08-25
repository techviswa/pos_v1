import env from "../config/env.js";
import prisma from "../database/prisma/client.js";
import { ensureBusiness, findBusinessById } from "../database/prisma/helpers.js";
import { FEATURE_KEYS_SET, FEATURE_REGISTRY } from "../shared/constants/feature.constants.js";
import { defaultFeatureToggles } from "../shared/data/feature-toggles.js";

class FeatureToggleService {
  normalizeFeatureName(featureName) {
    return String(featureName || "").trim();
  }

  normalizeBusinessId(businessId) {
    return String(businessId || env.defaultBusinessId).trim();
  }

  getEnabledFeatures(businessId) {
    const normalizedBusinessId = this.normalizeBusinessId(businessId);
    return this.getEnabledFeaturesAsync(normalizedBusinessId);
  }

  isKnownFeature(featureName) {
    return FEATURE_KEYS_SET.has(this.normalizeFeatureName(featureName));
  }

  getFeatureRegistry() {
    return FEATURE_REGISTRY;
  }

  getDefaultFeatureKeys() {
    return this.getFeatureRegistry().map((feature) => feature.key);
  }

  async getBusinessFeatureState(businessId) {
    const enabledFeatureSet = new Set(await this.getEnabledFeaturesAsync(businessId));

    return this.getFeatureRegistry().map((feature) => ({
      ...feature,
      enabled: enabledFeatureSet.has(feature.key),
    }));
  }

  async getEnabledFeaturesAsync(businessId) {
    const normalizedBusinessId = this.normalizeBusinessId(businessId);
    const business = await findBusinessById(normalizedBusinessId);
    const targetBusinessId = business?.id || normalizedBusinessId;
    const toggles = await prisma.featureToggle.findMany({
      where: { businessId: targetBusinessId, enabled: true },
    });

    if (toggles.length) {
      return toggles.map((toggle) => toggle.featureKey);
    }

    return (
      defaultFeatureToggles.get(targetBusinessId) ||
      defaultFeatureToggles.get(env.defaultBusinessId) ||
      this.getDefaultFeatureKeys()
    );
  }

  async setFeaturesForBusiness(businessId, featureNames) {
    const normalizedBusinessId = this.normalizeBusinessId(businessId);
    const normalizedFeatures = [
      ...new Set(
        (featureNames || [])
          .map((featureName) => this.normalizeFeatureName(featureName))
          .filter((featureName) => featureName && this.isKnownFeature(featureName))
      ),
    ];

    await ensureBusiness({
      businessId: normalizedBusinessId,
      tenantId:
        normalizedBusinessId === env.defaultBusinessId ? env.defaultTenantId : `${normalizedBusinessId}-tenant`,
    });

    await prisma.$transaction([
      prisma.featureToggle.deleteMany({
        where: { businessId: normalizedBusinessId },
      }),
      ...(normalizedFeatures.length
        ? [
            prisma.featureToggle.createMany({
              data: normalizedFeatures.map((featureKey) => ({
                businessId: normalizedBusinessId,
                featureKey,
                enabled: true,
              })),
            }),
          ]
        : []),
    ]);

    return normalizedFeatures;
  }

  async enableFeatureForBusiness(businessId, featureName) {
    const normalizedFeatureName = this.normalizeFeatureName(featureName);
    const currentFeatures = await this.getEnabledFeaturesAsync(businessId);
    return this.setFeaturesForBusiness(businessId, [...currentFeatures, normalizedFeatureName]);
  }

  async disableFeatureForBusiness(businessId, featureName) {
    const normalizedFeatureName = this.normalizeFeatureName(featureName);
    const currentFeatures = await this.getEnabledFeaturesAsync(businessId);
    return this.setFeaturesForBusiness(
      businessId,
      currentFeatures.filter((currentFeature) => currentFeature !== normalizedFeatureName)
    );
  }

  async isFeatureEnabled(featureName, businessId) {
    const normalizedFeatureName = this.normalizeFeatureName(featureName);
    if (!this.isKnownFeature(normalizedFeatureName)) {
      return false;
    }
    const enabledFeatures = await this.getEnabledFeaturesAsync(businessId);

    return enabledFeatures.includes(normalizedFeatureName);
  }
}

export const featureToggleService = new FeatureToggleService();
