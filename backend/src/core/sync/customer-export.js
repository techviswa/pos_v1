import { Prisma } from '@prisma/client';
import { createHttpError } from '../../shared/utils/http-error.js';

// Receipt-derived CRM agrees with the customer ledger: invoice totals less
// refunds. An associated order contributes a count, never a second sale amount.
export function serializeCustomerRows({ bills = [], orders = [], tenantId, businessId }) {
  const grouped = new Map();
  const now = new Date().toISOString();
  const voided = row => ['void', 'cancelled', 'canceled'].includes(String(row.status || '').toLowerCase());
  const orderId = row => row.order_id || row.orderId || row.metadata?.order_id;
  const billedOrders = new Set(bills.filter(row => !voided(row)).map(orderId).filter(Boolean));
  const knownProfiles = new Map();
  for (const row of [...bills, ...orders]) {
    const profile = row.customer_id || row.metadata?.customer_id;
    const contact = String(row.customer_phone || row.customerPhone || row.metadata?.customer_phone || '').replace(/\D/g, '');
    if (profile && contact && !row.privacy_erased && !row.metadata?.privacy_erased) knownProfiles.set(contact, profile);
  }
  const upsert = (row, invoice) => {
    const metadata = row.metadata || {};
    const name = String(row.customer_name || row.customerName || metadata.customer_name || '').trim();
    if (row.privacy_erased || metadata.privacy_erased || name.toLowerCase() === 'erased customer' || voided(row)) return;
    const phone = row.customer_phone || metadata.customer_phone || row.customerPhone || null;
    const digits = String(phone || '').replace(/\D/g, '');
    const profileId = row.customer_id || metadata.customer_id || knownProfiles.get(digits);
    if (!profileId && !digits) return; // Anonymous receipts do not identify a distinct person.
    const id = profileId ? `profile:${profileId}` : `phone:${digits}`;
    const current = grouped.get(id) || { id: id.replace(/[^a-zA-Z0-9_-]/g, '_'),
      customer_id: profileId || id.replace(/[^a-zA-Z0-9_-]/g, '_'),
      tenantId, tenant_id: tenantId, business_id: businessId, name: name || 'Customer', phone, email: null,
      order_count: 0, bill_count: 0, totals: new Map(), first_seen_at: row.created_at || row.createdAt || now,
      last_seen_at: row.updated_at || row.updatedAt || row.created_at || now,
      sync_source: 'pos-core', sync_resource: 'customers', last_synced_at: now };
    if (invoice) {
      let gross, refund;
      try {
        gross = new Prisma.Decimal(row.total ?? metadata.total ?? 0);
        refund = new Prisma.Decimal(row.refunded_amount ?? metadata.refunded_amount ?? 0);
        if (!gross.isFinite() || !refund.isFinite()) throw new Error('nonfinite');
      } catch { throw createHttpError({ statusCode: 409, code: 'CUSTOMER_INVOICE_INVALID', message: 'A source invoice contains an invalid amount; customer totals were withheld' }); }
      const currency = row.currency || metadata.currency || 'unspecified';
      current.totals.set(currency, (current.totals.get(currency) || new Prisma.Decimal(0)).plus(Prisma.Decimal.max(0, gross.minus(refund))));
      current.bill_count += 1;
      if (orderId(row)) current.order_count += 1;
    } else if (!billedOrders.has(row.id)) current.order_count += 1;
    const stamp = row.updated_at || row.updatedAt || row.created_at || row.createdAt;
    if (stamp && new Date(stamp) > new Date(current.last_seen_at)) current.last_seen_at = stamp;
    grouped.set(id, current);
  };
  bills.forEach(row => upsert(row, true));
  orders.forEach(row => upsert(row, false));
  return [...grouped.values()].map(({ totals, ...row }) => {
    const currencies = [...totals].map(([currency, amount]) => ({ currency, amount: amount.toDecimalPlaces(2).toNumber() }));
    return { ...row, total_spent: currencies.length > 1 ? null : currencies[0]?.amount || 0,
      total_spent_by_currency: currencies, currency: currencies.length === 1 ? currencies[0].currency : null,
      spend_definition: 'Invoice totals after refunds, including tax; void/cancelled invoices and order amounts excluded' };
  });
}
