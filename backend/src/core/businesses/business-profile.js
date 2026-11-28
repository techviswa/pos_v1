import prisma from '../../database/prisma/client.js';
import { hasActiveTransaction } from '../../database/prisma/rls-runtime.js';
import { createHttpError, createNotFoundError } from '../../shared/utils/http-error.js';
import { admincoreChangeSyncService } from '../admincore/admincore-change-sync.service.js';
import { DEFAULT_TIMEZONE, isValidTimezone } from '../../shared/utils/business-time.js';

// Shared settings belong to the business, never to a browser or signed-in staff member.
export const PROFILE_DEFAULTS = {
  gst: '', address: '', phone: '', taxRate: 18, footer: 'Thank you, visit again!',
  receiptOfferTitle: '', receiptOfferMessage: '', currency: '\u20b9', paymentMethods: ['Cash', 'UPI', 'Card'],
  // The business's calendar: reports, dashboard days and date filters count in this time zone.
  timezone: DEFAULT_TIMEZONE,
};
const keyFor = id => `business-profile:${id}`;
const fail = (message, statusCode = 400) => { throw createHttpError({ statusCode, code: 'BUSINESS_PROFILE_INVALID', message }); };
const validate = patch => {
  const result = {};
  const limits = { shopName: 120, gst: 32, address: 1000, phone: 40, footer: 1000, receiptOfferTitle: 120, receiptOfferMessage: 1000, currency: 3 };
  for (const [field, max] of Object.entries(limits)) {
    if (!Object.hasOwn(patch, field)) continue;
    if (typeof patch[field] !== 'string' || patch[field].trim().length > max) fail(`${field} must be text of at most ${max} characters`);
    result[field] = patch[field].trim();
    if (['shopName', 'currency'].includes(field) && !result[field]) fail(`${field} is required`);
  }
  if (Object.hasOwn(patch, 'taxRate')) {
    if (typeof patch.taxRate !== 'number' || !Number.isFinite(patch.taxRate) || patch.taxRate < 0 || patch.taxRate > 100) fail('taxRate must be between 0 and 100');
    result.taxRate = patch.taxRate;
  }
  if (Object.hasOwn(patch, 'timezone')) {
    if (!isValidTimezone(patch.timezone)) fail('Choose a valid time zone, for example Asia/Kolkata');
    result.timezone = patch.timezone;
  }
  if (Object.hasOwn(patch, 'paymentMethods')) {
    if (!Array.isArray(patch.paymentMethods) || !patch.paymentMethods.length || patch.paymentMethods.some(method => !['Cash', 'UPI', 'Card'].includes(method))) fail('Select at least one supported payment method');
    result.paymentMethods = [...new Set(patch.paymentMethods)];
  }
  return result;
};

export async function readBusinessProfile(businessId, db = prisma) {
  if (db === prisma && !hasActiveTransaction()) return prisma.$transaction(tx => readBusinessProfile(businessId, tx), { isolationLevel: 'RepeatableRead' });
  const business = await db.business.findUnique({ where: { id: String(businessId) } });
  if (!business) throw createNotFoundError('Business', { businessId });
  const document = await db.stateDocument.findUnique({ where: { key: keyFor(business.id) } });
  return { ...PROFILE_DEFAULTS, ...(document?.data || {}), shopName: business.name,
    business_id: business.id, tenant_id: business.tenantId, updated_at: business.updatedAt.toISOString(), persisted: Boolean(document) };
}

export async function updateBusinessProfile(businessId, patch) {
  const changes = validate(patch || {});
  if (!patch?.expected_updated_at || !Number.isFinite(Date.parse(patch.expected_updated_at))) fail('Reload the business profile before saving', 409);
  return prisma.$transaction(async tx => {
    const current = await readBusinessProfile(businessId, tx);
    // CAS on the business row serializes profile and rename writes across processes.
    const claimed = await tx.business.updateMany({ where: { id: String(businessId), updatedAt: new Date(patch.expected_updated_at) },
      data: { name: changes.shopName ?? current.shopName, updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)) } });
    if (claimed.count !== 1) fail('The business profile changed elsewhere. Reload and review your edits.', 409);
    const { shopName, business_id, tenant_id, updated_at, persisted, ...stored } = { ...current, ...changes };
    const data = { ...stored, business_id: current.business_id, tenant_id: current.tenant_id };
    await tx.stateDocument.upsert({ where: { key: keyFor(businessId) }, create: { key: keyFor(businessId), data }, update: { data } });
    await admincoreChangeSyncService.notifyChange({ resource: 'businesses', action: 'updated', recordId: businessId,
      businessId, tenantId: current.tenant_id }, { tx });
    return readBusinessProfile(businessId, tx);
  });
}
