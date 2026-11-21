import { randomUUID } from 'node:crypto';

export const OPERATIONAL_SIGNALS = Object.freeze({
  attendance: 'attendance', tips: 'tips', payroll: 'payroll', customers: 'customer-profiles',
  gift_cards: 'gift-cards', marketing: 'marketing', price_rules: 'menu-pricing',
  qr_feedback: 'guest-feedback', table_assistance: 'table-assistance',
});

// Called with the same transaction as the existing live signal. Payloads contain
// identifiers only; the receiving worker fetches current, scoped source records.
export async function queueOperationalSnapshot(client, signal, enabled) {
  const resource = OPERATIONAL_SIGNALS[signal.resource];
  if (!enabled || !resource || !signal.businessId) return null;
  const business = await client.business.findUnique({ where: { id: signal.businessId }, select: { id: true, tenantId: true } });
  if (!business?.tenantId) throw new Error('A verified business is required for operational sync');
  const event = { id: `operational_${randomUUID()}`, resource, action: 'snapshot',
    record_id: signal.recordId || null, business_id: business.id, tenant_id: business.tenantId,
    outlet_id: signal.outletId || null, changed_at: new Date().toISOString() };
  return client.backgroundJob.create({ data: { type: 'admincore.notify-change', payload: event, maxAttempts: 5 } });
}
