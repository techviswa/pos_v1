import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/database/prisma/client.js';
import env from '../src/config/env.js';
import { connectDatabase } from '../src/config/db.js';
import { runTenantScope } from '../src/database/prisma/tenant-context.js';
import { outletsService } from '../src/core/outlets/outlets.service.js';
import { admincoreChangeSyncService } from '../src/core/admincore/admincore-change-sync.service.js';

const businessId = `outlet-command-check-${randomUUID()}`, tenantId = `tenant-${businessId}`;
const scoped = fn => runTenantScope({ businessId, tenantId }, fn);
const enabled = env.admincore.enabled;
const originalNotify = admincoreChangeSyncService.notifyChange;
try {
  env.admincore.enabled = false;
  await connectDatabase();
  await prisma.business.create({ data: { id: businessId, tenantId, name: 'Isolated outlet command check' } });
  await scoped(async () => {
    await prisma.product.create({ data: { businessId, name: 'Preserved menu item', category: 'Test', price: 10, stock: 5 } });
    const sourceOutletId = 'aco_' + randomUUID().replaceAll('-', '');
    const commandId = randomUUID();
    const create = () => outletsService.createOutlet({ tenantId, sourceOutletId, commandId,
      payload: { name: 'Fixture outlet', code: randomUUID().slice(0, 8) } });
    // A replay uses exactly the same request body, including the generated code.
    const payload = { name: 'Fixture outlet', code: randomUUID().slice(0, 8) };
    const sameCreate = () => outletsService.createOutlet({ tenantId, sourceOutletId, commandId, payload });
    const [first, replay] = await Promise.all([sameCreate(), sameCreate()]);
    assert.equal(first.id, sourceOutletId); assert.equal(replay.id, sourceOutletId);
    assert.equal(await prisma.outlet.count({ where: { businessId } }), 1);
    assert.equal(first.products.length, 1); assert(first.features.length > 0);
    const updateId = randomUUID();
    const change = () => outletsService.updateOutlet({ tenantId, outletId: first.id, commandId: updateId,
      expectedUpdatedAt: first.updated_at, payload: { name: 'Confirmed name', assigned_user_ids: [] } });
    const changed = await change();
    assert.equal((await change()).name, 'Confirmed name');
    assert.equal(changed.products.length, 1); assert.equal(changed.features.length, first.features.length);
    await assert.rejects(outletsService.updateOutlet({ tenantId, outletId: first.id, commandId: randomUUID(),
      expectedUpdatedAt: first.updated_at, payload: { name: 'Stale edit' } }), error => error.code === 'OUTLET_VERSION_CONFLICT');
    await assert.rejects(outletsService.updateOutlet({ tenantId, outletId: first.id,
      payload: { name: 'Must roll back', assigned_user_ids: ['unknown-user'] } }), error => error.code === 'REFERENCE_NOT_IN_BUSINESS');
    assert.equal((await outletsService.getOutletById({ tenantId, outletId: first.id })).name, 'Confirmed name');
    admincoreChangeSyncService.notifyChange = async () => { throw new Error('outbox unavailable'); };
    await assert.rejects(create(), /outbox unavailable|request was already submitted/);
    await assert.rejects(outletsService.createOutlet({ tenantId, payload: { name: 'Must roll back', code: randomUUID().slice(0, 8) } }), /outbox unavailable/);
    await assert.rejects(outletsService.updateOutlet({ tenantId, outletId: first.id, payload: { phone: 'must-not-save' } }), /outbox unavailable/);
    admincoreChangeSyncService.notifyChange = originalNotify;
    assert.equal(await prisma.outlet.count({ where: { businessId } }), 1);
    assert.equal((await outletsService.getOutletById({ tenantId, outletId: first.id })).phone, '');
    await assert.rejects(prisma.$transaction(async tx => {
      const nested = await outletsService.createOutlet({ tenantId, transaction: tx, payload: { name: 'Nested rollback', code: randomUUID().slice(0, 8) } });
      assert.equal(nested.products.length, 1);
      assert(nested.features.length > 0);
      throw new Error('parent rollback');
    }), /parent rollback/);
    assert.equal(await prisma.outlet.count({ where: { businessId } }), 1);
    const archived = await outletsService.deleteOutlet({ tenantId, outletId: first.id, commandId: randomUUID(), expectedUpdatedAt: changed.updated_at });
    assert.equal(archived.status, 'inactive'); assert.equal(archived.products.length, 1);
  });
  console.log('Outlet commands passed: concurrent create replay, stale edits, atomic assignment/outbox rollback, parent transaction rollback, preserved menu/features and historical deactivation');
} finally {
  env.admincore.enabled = enabled;
  admincoreChangeSyncService.notifyChange = originalNotify;
  await scoped(async () => {
    await prisma.stateDocument.deleteMany({ where: { data: { path: ['business_id'], equals: businessId } } });
    await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  });
  await prisma.$disconnect();
}
