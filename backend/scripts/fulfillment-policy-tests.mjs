import assert from 'node:assert/strict';
import { saasStore } from '../src/core/saas/saas-store.js';
import { assertFulfillmentEnabled, getFulfillmentPolicy, resolveBillingMode, validateFulfillmentPolicy } from '../src/core/billing/fulfillment-policy.js';
const original = saasStore.getBusinessConfig;
saasStore.getBusinessConfig = async id => id === 'restricted' ? { fulfillment_modes: { TABLE: false, TOKEN: true, PICKUP: false, DELIVERY: false } } : null;
try {
  assert.deepEqual(await getFulfillmentPolicy('legacy'), { TABLE: true, TOKEN: true, PICKUP: true, DELIVERY: true });
  for (const service_mode of ['TABLE', 'PICKUP', 'DELIVERY']) await assert.rejects(assertFulfillmentEnabled('restricted', { service_mode }), error => error.statusCode === 403);
  await assertFulfillmentEnabled('restricted', { order_type: 'Takeaway' });
  await assertFulfillmentEnabled('legacy', { service_mode: 'DELIVERY' });
  assert.equal(resolveBillingMode({ menu_channel: 'Dine-In' }), 'TABLE');
  assert.throws(() => resolveBillingMode({ service_mode: 'garbage' }));
  assert.throws(() => validateFulfillmentPolicy({ TABLE: 'false', TOKEN: true, PICKUP: true, DELIVERY: true }));
  assert.deepEqual(validateFulfillmentPolicy({ TABLE: false, TOKEN: false, PICKUP: false, DELIVERY: false }), { TABLE: false, TOKEN: false, PICKUP: false, DELIVERY: false });
  console.log('Fulfillment policy validation, tenant isolation, legacy defaults, aliases and all four API decisions passed.');
} finally { saasStore.getBusinessConfig = original; }
