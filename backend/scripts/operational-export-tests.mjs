import test from 'node:test';
import assert from 'node:assert/strict';
import { exportOperationalRows, OPERATIONAL_EXPORT_RESOURCES } from '../src/core/sync/operational-exports.js';

const business = { id: 'business-a', tenantId: 'tenant-a' };
const fixture = (row) => {
  const calls = [];
  const client = new Proxy({}, { get: (_, model) => ({ findMany: async query => { calls.push({ model, query }); return [row]; } }) });
  return { calls, client };
};

test('every operational export scopes and pages its query and adds verified identities', async () => {
  for (const resource of OPERATIONAL_EXPORT_RESOURCES.filter(key => !['table-assistance', 'privacy-erasures'].includes(key))) {
    const { client, calls } = fixture({ id: 'r', businessId: business.id, name: 'Test', amount: 0 });
    const rows = await exportOperationalRows({ resource, business, query: { limit: 50, offset: 100 }, client });
    assert.equal(calls[0].query.where.businessId, business.id);
    assert.equal(calls[0].query.take, 50); assert.equal(calls[0].query.skip, 100);
    assert.deepEqual(calls[0].query.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
    assert.equal(rows[0].business_id, business.id); assert.equal(rows[0].tenant_id, business.tenantId);
  }
});

test('privacy marker exports page scoped state documents and exclude raw contact data', async () => {
  const { client, calls } = fixture({ key: `privacy-erasure:${business.id}:customer`, data: { id: 'customer',
    customer_id: 'customer', business_id: business.id, phone_digest: 'keyed-digest', erased_at: 'now', phone: 'PRIVATE-PHONE' } });
  const [row] = await exportOperationalRows({ resource: 'privacy-erasures', business, query: { limit: 50, offset: 100 }, client });
  assert.equal(calls[0].query.where.key.startsWith, `privacy-erasure:${business.id}:`);
  assert.equal(calls[0].query.take, 50); assert.equal(calls[0].query.skip, 100);
  assert.equal(row.business_id, business.id); assert.equal(row.phone_digest, 'keyed-digest');
  assert.equal(row.phone, undefined);
  const foreign = fixture({ data: { id: 'customer', business_id: 'other' } });
  await assert.rejects(exportOperationalRows({ resource: 'privacy-erasures', business, client: foreign.client }), /mismatch/);
});

test('assistance exports scope stored documents and expire requests from ended sessions', async () => {
  let query;
  const client = { stateDocument: { findMany: async value => { query = value; return [{ data: { id: 'request', business_id: business.id, table_name: 'T1', kind: 'water', session_id: 'session', status: 'pending', created_at: '2026-01-01T12:00:00Z', secret: 'hidden' } }]; } },
    tableSession: { findMany: async () => [] } };
  const [row] = await exportOperationalRows({ resource: 'table-assistance', business, client });
  assert.equal(query.where.key.startsWith, `assistance:${business.id}:`);
  assert.equal(row.status, 'expired'); assert.equal(row.secret, undefined); assert.equal(row.session_id, undefined);
  assert.equal(row.tenant_id, business.tenantId);
});

test('export refuses missing scope and foreign records', async () => {
  const { client } = fixture({ id: 'foreign', businessId: 'other-business' });
  await assert.rejects(exportOperationalRows({ resource: 'tips', business, client }), /outside/);
  await assert.rejects(exportOperationalRows({ resource: 'tips', business: {}, client }), /verified/);
});

test('gift-card redemption code and anonymized customer PII are not exported', async () => {
  let { client } = fixture({ id: 'card', businessId: business.id, code: 'PRIVATE-REDEEM-1234', balance: 0 });
  const [card] = await exportOperationalRows({ resource: 'gift-cards', business, client });
  assert.equal(card.code, undefined); assert.equal(card.masked_code, '•••• 1234'); assert.equal(card.balance, 0);
  ({ client } = fixture({ id: 'customer', businessId: business.id, name: 'Erased name', phone: '123', email: 'private@example.com', anonymizedAt: new Date() }));
  const [customer] = await exportOperationalRows({ resource: 'loyalty-customers', business, client });
  assert.equal(customer.phone, null); assert.equal(customer.email, null); assert.equal(customer.name, 'Anonymized customer');
});

test('outlet filters are applied or explicitly rejected, not silently widened', async () => {
  const { client, calls } = fixture({ id: 'tip', businessId: business.id });
  await exportOperationalRows({ resource: 'tips', business, client, query: { outlet_id: 'outlet-a' } });
  assert.equal(calls[0].query.where.outletId, 'outlet-a');
  await assert.rejects(exportOperationalRows({ resource: 'payroll', business, client, query: { outlet_id: 'outlet-a' } }), /business-wide/);
});

test('deleted attendance is excluded and payroll excludes private pay profiles', async () => {
  const { client, calls } = fixture({ id: 'row', businessId: business.id, clockOutAt: new Date() });
  const [entry] = await exportOperationalRows({ resource: 'attendance', business, client });
  assert.equal(calls[0].query.where.deletedAt, null); assert.equal(entry.status, 'completed');
  await exportOperationalRows({ resource: 'payroll', business, client });
  assert.deepEqual(calls[1].query.select._count, { select: { payslips: true } });
  assert.equal(calls[1].query.select.profile, undefined);
});
