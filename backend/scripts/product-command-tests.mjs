import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/database/prisma/client.js';
import env from '../src/config/env.js';
import { connectDatabase } from '../src/config/db.js';
import { runTenantScope } from '../src/database/prisma/tenant-context.js';
import { productsService } from '../src/core/products/products.service.js';
import { outletsService } from '../src/core/outlets/outlets.service.js';
import { admincoreChangeSyncService } from '../src/core/admincore/admincore-change-sync.service.js';

const businessId = `product-command-check-${randomUUID()}`, tenantId = `tenant-${businessId}`;
const scoped = fn => runTenantScope({ businessId, tenantId }, fn);
const enabled = env.admincore.enabled;
const originalNotify = admincoreChangeSyncService.notifyChange;
try {
  env.admincore.enabled = false;
  await connectDatabase();
  await prisma.business.create({ data: { id: businessId, tenantId, name: 'Isolated product command check' } });
  await scoped(async () => {
    const sourceProductId = 'acp_' + randomUUID().replaceAll('-', '');
    const commandId = randomUUID();
    const create = () => productsService.createProduct({ tenantId, sourceProductId, commandId,
      payload: { name: 'Command item', category: 'Test', price: 10, stock: 5,
        variation_options: [{ name: 'Small', price: 1 }], addon_options: [{ name: 'Extra', price: 2 }] } });
    const [first, replay] = await Promise.all([create(), create()]);
    assert.equal(first.id, sourceProductId); assert.equal(replay.id, sourceProductId);
    assert.equal(await prisma.product.count({ where: { businessId } }), 1);
    assert.equal(first.variation_options.length, 1); assert.equal(first.addon_options.length, 1);
    const updateId = randomUUID();
    const update = () => productsService.updateProduct({ tenantId, productId: first.id, commandId: updateId,
      expectedUpdatedAt: first.updated_at, payload: { price: 12 } });
    const changed = await update();
    const repeated = await update();
    assert.equal(Number(changed.price), 12); assert.equal(Number(repeated.price), 12);
    await assert.rejects(productsService.updateProduct({ tenantId, productId: first.id, commandId: randomUUID(), expectedUpdatedAt: first.updated_at, payload: { price: 99 } }), error => error.code === 'PRODUCT_VERSION_CONFLICT');
    assert.equal(Number((await productsService.getProductById({ tenantId, productId: first.id })).price), 12);
    admincoreChangeSyncService.notifyChange = async () => { throw new Error('outbox unavailable'); };
    await assert.rejects(productsService.createProduct({ tenantId, payload: { name: 'Must roll back', price: 20, stock: 1 } }), /outbox unavailable/);
    assert.equal(await prisma.product.count({ where: { businessId } }), 1, 'A failed outbox must roll back the complete product creation');
    admincoreChangeSyncService.notifyChange = originalNotify;
    await assert.rejects(productsService.updateProduct({ tenantId, productId: first.id, payload: { price: -1 } }), error => error.code === 'INVALID_PRODUCT_NUMBER');
    await Promise.all([3, 4].map(quantity => productsService.adjustProductStock({ tenantId, productId: first.id, payload: { operation: 'add', quantity } })));
    assert.equal((await productsService.getProductById({ tenantId, productId: first.id })).stock, 12, 'Concurrent adjustments must both apply');
    const adjustment = { operation: 'add', quantity: 2, request_id: randomUUID() };
    await Promise.all([1, 2].map(() => productsService.adjustProductStock({ tenantId, productId: first.id, payload: adjustment })));
    assert.equal((await productsService.getProductById({ tenantId, productId: first.id })).stock, 14, 'A replayed adjustment must apply once');
    await assert.rejects(productsService.adjustProductStock({ tenantId, productId: first.id, payload: { quantity: -1 } }), error => error.code === 'INVALID_STOCK_ADJUSTMENT');
    const outlet = await outletsService.createOutlet({ tenantId, payload: { name: 'Fixture outlet', code: randomUUID().slice(0, 8) } });
    const assigned = await outletsService.updateOutlet({ tenantId, outletId: outlet.id, payload: { assigned_user_ids: [] } });
    assert.deepEqual(assigned.assigned_user_ids, []);
    assert.equal(assigned.products.length, 1, 'Updating staff assignments must preserve the outlet menu');
    assert(assigned.features.length > 0, 'Existing outlet feature controls must remain available');
  });
  console.log('Product commands passed: create/update replay, atomic choices/add-ons, version conflict, outbox rollback, numeric validation, concurrent stock adjustments and adjustment replay');
} finally {
  admincoreChangeSyncService.notifyChange = originalNotify;
  env.admincore.enabled = enabled;
  await scoped(async () => {
    await prisma.stateDocument.deleteMany({ where: { data: { path: ['business_id'], equals: businessId } } });
    await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  });
  await prisma.$disconnect();
}
