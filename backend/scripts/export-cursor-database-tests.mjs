import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/database/prisma/client.js';
import { connectDatabase } from '../src/config/db.js';
import { runTenantScope } from '../src/database/prisma/tenant-context.js';
import { syncService } from '../src/core/sync/sync.service.js';

const businessId = `export-cursor-check-${randomUUID()}`, tenantId = `tenant-${businessId}`;
const scoped = fn => runTenantScope({ businessId, tenantId }, fn);
const prefix = randomUUID();
const nextPage = (resource, previous) => syncService.exportResource({ resource, tenantId, businessId,
  query: { limit: 1, offset: previous.meta.pagination.next_offset, cursor: previous.meta.pagination.next_cursor } });
try {
  await connectDatabase();
  await prisma.business.create({ data: { id: businessId, tenantId, name: 'Isolated cursor check' } });
  await scoped(async () => {
    await prisma.product.createMany({ data: ['a', 'b', 'c'].map(id => ({ id: `${prefix}-${id}`, businessId, name: `Fixture ${id}`, category: 'Test', price: 10, stock: 2 })) });
    let page = await syncService.exportResource({ resource: 'products', tenantId, businessId, query: { limit: 1 } });
    assert.equal(page.items[0].id, `${prefix}-a`);
    await prisma.product.deleteMany({ where: { id: `${prefix}-a`, businessId } });
    await prisma.product.update({ where: { id: `${prefix}-b` }, data: { name: 'Changed while paging' } });
    await prisma.product.create({ data: { id: `${prefix}-z`, businessId, name: 'Next export', category: 'Test', price: 10, stock: 2 } });
    page = await nextPage('products', page);
    assert.equal(page.items[0].id, `${prefix}-b`);
    assert.equal(page.items[0].name, 'Changed while paging');
    page = await nextPage('products', page);
    assert.equal(page.items[0].id, `${prefix}-c`);
    assert.equal(page.meta.pagination.has_more, false);
    assert.equal(page.meta.pagination.complete_scope, true);
    for (const id of ['a', 'b', 'c']) await prisma.customer.create({ data: { id: `${prefix}-customer-${id}`, businessId, name: `Fixture ${id}`, phone: `fixture-${prefix}-${id}` } });
    page = await syncService.exportResource({ resource: 'loyalty-customers', tenantId, businessId, query: { limit: 1 } });
    await prisma.customer.deleteMany({ where: { id: `${prefix}-customer-a`, businessId } });
    page = await nextPage('loyalty-customers', page);
    assert.equal(page.items[0].id, `${prefix}-customer-b`);
    for (const id of ['a', 'b']) await prisma.stateDocument.create({ data: { key: `assistance:${businessId}:${id}`, data: { id, business_id: businessId, table_name: 'Fixture', kind: 'water', status: 'resolved', created_at: new Date().toISOString() } } });
    page = await syncService.exportResource({ resource: 'table-assistance', tenantId, businessId, query: { limit: 1 } });
    assert.equal(page.items[0].id, 'a');
    await prisma.stateDocument.deleteMany({ where: { key: `assistance:${businessId}:a` } });
    page = await nextPage('table-assistance', page);
    assert.equal(page.items[0].id, 'b');
    assert.equal(page.meta.pagination.has_more, false);
  });
  console.log('Database cursor checks passed: product/customer deletion during paging, live updates, fixed upper bounds and scoped state-document keys');
} finally {
  await scoped(async () => {
    await prisma.stateDocument.deleteMany({ where: { data: { path: ['business_id'], equals: businessId } } });
    await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  });
  await prisma.$disconnect();
}
