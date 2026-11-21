import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import prisma from '../src/database/prisma/client.js';
import { syncService, collectExportRows } from '../src/core/sync/sync.service.js';
import { readExportPage } from '../src/shared/utils/export-cursor.js';
import { jobQueue } from '../src/services/jobs/job-queue.js';
import { buildExportSnapshot, requestExportSnapshot, cleanupExpiredSnapshots } from '../src/core/sync/export-snapshot.js';
import { assertExportAccess } from '../src/core/sync/export-access.js';

const businessId = 'snapshot-' + randomUUID(), tenantId = 'tenant-' + businessId;
const raw = new PrismaClient();
const args = { resource: 'products', businessId, tenantId };
try {
  await prisma.business.create({ data: { id: businessId, tenantId, name: 'Isolated frozen-export acceptance' } });
  await prisma.product.createMany({ data: ['a', 'b', 'c'].map(suffix => ({ id: `${businessId}-${suffix}`, businessId, name: suffix, price: 10, category: 'Fixture' })) });
  const query = { limit: 1, snapshot_request: randomUUID() };
  const pending = await requestExportSnapshot({ ...args, query });
  assert.equal(pending.status, 202);
  const id = pending.body.snapshot.id;
  const duplicate = await requestExportSnapshot({ ...args, query: { ...query, snapshot_request: randomUUID() } });
  assert.equal(duplicate.body.snapshot.id, id, 'Concurrent/retried requests reuse the active build');
  const job = await jobQueue.get(id);
  await buildExportSnapshot(job.payload, params => syncService.exportResource(params), async page => {
    if (page !== 0) return;
    await raw.product.update({ where: { id: `${businessId}-b` }, data: { price: 99 } });
    await raw.product.delete({ where: { id: `${businessId}-a` } });
  });
  await prisma.backgroundJob.update({ where: { id }, data: { status: 'completed' } });
  let page = await requestExportSnapshot({ ...args, query: { limit: 1, export_id: id } });
  assert.equal(page.body.items[0].id, `${businessId}-a`, 'Frozen export retains a row deleted after its first read');
  assert.equal(page.body.meta.pagination.strategy, 'frozen-snapshot-v1');
  const first = page.body.meta.pagination;
  page = await requestExportSnapshot({ ...args, query: { limit: 1, export_id: id, offset: first.next_offset, cursor: first.next_cursor } });
  assert.equal(page.body.items[0].price, 10, 'A later page must retain its original price, despite concurrent changes');
  const second = page.body.meta.pagination;
  page = await requestExportSnapshot({ ...args, query: { limit: 1, export_id: id, offset: second.next_offset, cursor: second.next_cursor } });
  assert.equal(page.body.items[0].id, `${businessId}-c`); assert.equal(page.body.meta.pagination.has_more, false);
  await assert.rejects(() => requestExportSnapshot({ ...args, query: { limit: 1, export_id: id, offset: 1, cursor: 'tampered' } }), error => error.statusCode === 409);
  await assert.rejects(() => requestExportSnapshot({ ...args, query: { limit: 1, export_id: id, status: 'changed' } }), error => error.statusCode === 409);
  await assert.rejects(() => requestExportSnapshot({ ...args, businessId: 'other', query: { limit: 1, export_id: id } }), error => error.statusCode === 404);
  await prisma.stateDocument.update({ where: { key: `privacy-epoch:${businessId}` }, data: { data: { business_id: businessId, revision: randomUUID() } } });
  await assert.rejects(() => requestExportSnapshot({ ...args, query: { limit: 1, export_id: id } }), error => error.code === 'EXPORT_INVALIDATED');
  const docs = await prisma.stateDocument.findMany({ where: { key: { startsWith: `export-snapshot:${businessId}:` } } });
  for (const doc of docs) await prisma.stateDocument.update({ where: { key: doc.key }, data: { data: { ...doc.data, expires_at: '2000-01-01T00:00:00Z' } } });
  assert.equal(await cleanupExpiredSnapshots(), docs.length);
  assert.equal(await prisma.stateDocument.count({ where: { key: { startsWith: `export-snapshot:${businessId}:` } } }), 0);
  assert.throws(() => assertExportAccess('payroll', ['billing']), error => error.statusCode === 403);
  assert.throws(() => assertExportAccess('privacy-erasures', ['settings']), error => error.statusCode === 403);
  assertExportAccess('bills', ['bills']); assertExportAccess('payroll', [], { bridge: true });
  const large = await requestExportSnapshot({ ...args, resource: 'orders', query: { limit: 250, snapshot_request: randomUUID() } });
  const largeJob = await jobQueue.get(large.body.snapshot.id);
  const virtualRows = Array.from({ length: 50001 }, (_, index) => ({ id: String(index).padStart(6, '0'), total: 1 }));
  const delegate = {
    findFirst: async () => virtualRows.at(-1),
    findMany: async options => {
      const condition = options.where.AND.at(-1).id;
      return virtualRows.filter(row => row.id <= condition.lte && (!condition.gt || row.id > condition.gt)).slice(0, options.take);
    },
  };
  await buildExportSnapshot(largeJob.payload, async () => ({ resource: 'orders', business_id: businessId, tenant_id: tenantId,
    items: await collectExportRows(page => readExportPage(delegate, {}, page)), meta: {} }));
  const largePage = await requestExportSnapshot({ ...args, resource: 'orders', query: { limit: 250, export_id: largeJob.id } });
  assert.equal(largePage.body.meta.snapshot.count, 50001, 'Background collectors must advance beyond the former 50,000-row cap');
  let nextPage = largePage, consumed = 0;
  do {
    consumed += nextPage.body.items.length;
    const paging = nextPage.body.meta.pagination;
    if (!paging.has_more) break;
    nextPage = await requestExportSnapshot({ ...args, resource: 'orders', query: { limit: 250, export_id: largeJob.id, offset: paging.next_offset, cursor: paging.next_cursor } });
  } while (true);
  assert.equal(consumed, 50001); assert.equal(nextPage.body.items.at(-1).id, '050000');
  console.log('Frozen exports passed: repeatable-read prices/deletions, durable active-build reuse, scope/filter/cursor rejection, privacy invalidation, retention and export permissions');
} finally {
  await prisma.stateDocument.deleteMany({ where: { OR: [{ key: { startsWith: `export-snapshot:${businessId}:` } }, { key: `privacy-epoch:${businessId}` }] } });
  await prisma.backgroundJob.deleteMany({ where: { payload: { path: ['business_id'], equals: businessId } } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await Promise.all([prisma.$disconnect(), raw.$disconnect()]);
}
