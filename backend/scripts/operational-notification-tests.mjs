import test from 'node:test';
import assert from 'node:assert/strict';
import { queueOperationalSnapshot, OPERATIONAL_SIGNALS } from '../src/core/sync/operational-notifications.js';

test('new operational signals create durable current-state jobs with verified tenant scope', async () => {
  for (const [resource, target] of Object.entries(OPERATIONAL_SIGNALS)) {
    let written;
    const client = { business: { findUnique: async () => ({ id: 'b', tenantId: 't' }) },
      backgroundJob: { create: async args => { written = args.data; return written; } } };
    await queueOperationalSnapshot(client, { businessId: 'b', resource, recordId: 'r', action: 'deleted', secret: 'private' }, true);
    assert.equal(written.type, 'admincore.notify-change'); assert.equal(written.payload.resource, target);
    assert.equal(written.payload.business_id, 'b'); assert.equal(written.payload.tenant_id, 't');
    assert.equal(written.payload.action, 'snapshot'); assert.equal(written.payload.secret, undefined);
  }
});

test('disabled bridges and unrelated live signals do not create duplicate outbox jobs', async () => {
  assert.equal(await queueOperationalSnapshot({}, { businessId: 'b', resource: 'tips' }, false), null);
  assert.equal(await queueOperationalSnapshot({}, { businessId: 'b', resource: 'orders' }, true), null);
});

test('outbox failure propagates to the caller transaction', async () => {
  const client = { business: { findUnique: async () => ({ id: 'b', tenantId: 't' }) }, backgroundJob: { create: async () => { throw new Error('queue unavailable'); } } };
  await assert.rejects(queueOperationalSnapshot(client, { businessId: 'b', resource: 'tips' }, true), /queue unavailable/);
});
