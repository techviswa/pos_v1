import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import prisma from '../../database/prisma/client.js';
import env from '../../config/env.js';
import { jobQueue } from '../../services/jobs/job-queue.js';
import { createHttpError } from '../../shared/utils/http-error.js';
import { errorMonitor } from '../../shared/utils/error-monitor.js';

const buildContext = new AsyncLocalStorage();
const TYPE = 'admincore.export-snapshot';
const TTL = 15 * 60 * 1000;
const MAX_ROWS = 1000000;
const internalKeys = new Set(['consistent', 'export_id', 'snapshot_request', 'cursor', 'offset', 'limit', 'page']);
const scopeKeys = new Set(['business_id', 'businessId', 'tenant_id', 'tenantId']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const filtersFor = query => Object.fromEntries(Object.entries(query).filter(([key]) => !internalKeys.has(key)));
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const keyFor = (business, id, part) => `export-snapshot:${business}:${id}:${part}`;
const fail = (statusCode, code, message) => createHttpError({ statusCode, code, message });
const secret = () => env.admincore.apiKey || env.auth.jwtSecret;
const token = (id, offset) => `${id}.${offset}.${createHmac('sha256', secret()).update(`${id}:${offset}`).digest('hex')}`;
export const snapshotRowLimit = () => buildContext.getStore() ? MAX_ROWS : 50000;

export async function buildExportSnapshot(payload, loader, afterPage = async () => {}) {
  const { business_id: businessId, tenant_id: tenantId, resource, id, filters, limit, filter_hash: filterHash } = payload;
  const expiresAt = new Date(Date.now() + TTL).toISOString();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`privacy-snapshot:${businessId}`}))`;
    const epochKey = `privacy-epoch:${businessId}`;
    const epoch = await tx.stateDocument.findUnique({ where: { key: epochKey } });
    // A concurrent erasure before the lock must force a repeatable-read retry.
    const epochData = epoch?.data || { business_id: businessId, revision: randomUUID() };
    await tx.stateDocument.upsert({ where: { key: epochKey }, create: { key: epochKey, data: epochData }, update: { data: epochData } });
    let cursor, offset = 0, count = 0, chunk = 0, envelope;
    const buffer = [];
    const flush = async rows => {
      const key = keyFor(businessId, id, chunk++);
      const content = { business_id: businessId, tenant_id: tenantId, expires_at: expiresAt,
        rows: JSON.parse(JSON.stringify(rows)) };
      await tx.stateDocument.upsert({ where: { key }, create: { key, data: content }, update: { data: content } });
    };
    await buildContext.run(true, async () => {
      for (let page = 0; ; page++) {
        const data = await loader({ resource, businessId, tenantId, query: { ...filters, limit, offset, ...(cursor ? { cursor } : {}) } });
        if (data.business_id !== businessId || data.tenant_id !== tenantId) throw fail(409, 'EXPORT_SCOPE_CHANGED', 'Export scope changed');
        envelope ||= { ...data, items: undefined, data: undefined };
        const rows = data.items || [];
        count += rows.length;
        if (count > MAX_ROWS || page > MAX_ROWS) throw fail(413, 'EXPORT_TOO_LARGE', 'Export exceeds the configured one-million-record safety limit');
        for (const row of rows) {
          buffer.push(row);
          if (buffer.length === limit) await flush(buffer.splice(0));
        }
        await afterPage(page);
        const paging = data.meta?.pagination;
        if (!paging?.has_more) break;
        if (!paging.next_cursor || paging.next_offset <= offset) throw fail(502, 'EXPORT_CURSOR_INVALID', 'Source export failed to advance');
        cursor = paging.next_cursor; offset = paging.next_offset;
      }
      if (buffer.length) await flush(buffer.splice(0));
    });
    const key = keyFor(businessId, id, 'manifest');
    const data = JSON.parse(JSON.stringify({ business_id: businessId, tenant_id: tenantId, resource, id,
      count, chunks: chunk, limit, filter_hash: filterHash, expires_at: expiresAt,
      created_at: new Date().toISOString(), privacy_epoch: epochData.revision, envelope }));
    await tx.stateDocument.upsert({ where: { key }, create: { key, data }, update: { data } });
    return { id, count, expires_at: expiresAt };
  }, { isolationLevel: 'RepeatableRead', timeout: 240000, maxWait: 15000 });
}

export function registerSnapshotWorker(loader) {
  jobQueue.registerHandler(TYPE, payload => buildExportSnapshot(payload, loader));
  const timer = setInterval(() => void cleanupExpiredSnapshots().catch(error => errorMonitor.captureException(error, { lifecycle: 'export_retention' })), 60000);
  timer.unref?.();
}

export async function requestExportSnapshot({ resource, businessId, tenantId, query }) {
  const limit = Number(query.limit || 250), offset = Number(query.offset || 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250 || !Number.isSafeInteger(offset) || offset < 0) throw fail(400, 'EXPORT_PAGE_INVALID', 'Invalid export page');
  const filters = filtersFor(query), filterHash = hash(filters);
  let id = query.export_id;
  if (!id) {
    if (offset || query.cursor) throw fail(409, 'EXPORT_CURSOR_INVALID', 'Start a snapshot from its first page');
    const request = String(query.snapshot_request || randomUUID());
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(request)) throw fail(400, 'EXPORT_REQUEST_INVALID', 'Invalid snapshot request ID');
    id = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`export-request:${businessId}:${resource}:${filterHash}`}))`;
      const active = await tx.backgroundJob.findFirst({ where: { type: TYPE, status: { in: ['queued', 'running', 'retrying'] },
        AND: [{ payload: { path: ['business_id'], equals: businessId } }, { payload: { path: ['tenant_id'], equals: tenantId } },
          { payload: { path: ['resource'], equals: resource } }, { payload: { path: ['filter_hash'], equals: filterHash } },
          { payload: { path: ['limit'], equals: limit } }] } });
      if (active) return active.id;
      const jobId = 'export-' + hash({ businessId, tenantId, resource, request });
      const existing = await tx.backgroundJob.findUnique({ where: { id: jobId } });
      if (!existing) await tx.backgroundJob.create({ data: { id: jobId, type: TYPE, maxAttempts: 3,
        payload: { id: jobId, business_id: businessId, tenant_id: tenantId, resource, filters, limit, filter_hash: filterHash } } });
      return jobId;
    });
  }
  if (!/^export-[a-f0-9]{64}$/.test(id)) throw fail(400, 'EXPORT_REQUEST_INVALID', 'Invalid snapshot ID');
  jobQueue.wake();
  const job = await jobQueue.get(id);
  if (!job || job.type !== TYPE || job.payload.business_id !== businessId || job.payload.tenant_id !== tenantId || job.payload.resource !== resource) throw fail(404, 'EXPORT_NOT_FOUND', 'Export not found');
  if (job.payload.filter_hash !== filterHash || job.payload.limit !== limit) throw fail(409, 'EXPORT_SCOPE_CHANGED', 'Export filters changed; start a new snapshot');
  const manifest = (await prisma.stateDocument.findUnique({ where: { key: keyFor(businessId, id, 'manifest') } }))?.data;
  if (!manifest) {
    if (job.status === 'failed' && /safety (limit|budget)/.test(job.error || '')) throw fail(413, 'EXPORT_RESOURCE_LIMIT', 'Export exceeds its record or memory safety budget; narrow the export scope');
    if (job.status === 'failed') throw fail(job.error === 'Export invalidated by customer erasure' ? 410 : 503, 'EXPORT_BUILD_FAILED', 'Snapshot generation failed or was invalidated; start a new snapshot or inspect export worker health');
    if (job.status === 'completed') throw fail(410, 'EXPORT_EXPIRED', 'Export snapshot expired or was invalidated; start a new snapshot');
    return { status: 202, body: { resource, business_id: businessId, tenant_id: tenantId, snapshot: { id, status: job.status, retry_after: 1 } } };
  }
  if (manifest.expires_at <= new Date().toISOString()) throw fail(410, 'EXPORT_EXPIRED', 'Export snapshot expired; start a new snapshot');
  const epoch = await prisma.stateDocument.findUnique({ where: { key: `privacy-epoch:${businessId}` } });
  if (epoch?.data.revision !== manifest.privacy_epoch) throw fail(410, 'EXPORT_INVALIDATED', 'Customer data changed; start a new snapshot');
  if (offset) {
    const expected = Buffer.from(token(id, offset)), supplied = Buffer.from(String(query.cursor || ''));
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw fail(409, 'EXPORT_CURSOR_INVALID', 'Invalid snapshot continuation');
  } else if (query.cursor) throw fail(409, 'EXPORT_CURSOR_INVALID', 'Unexpected first-page continuation');
  if (offset % limit || offset > manifest.count) throw fail(409, 'EXPORT_CURSOR_INVALID', 'Invalid snapshot offset');
  const chunk = (await prisma.stateDocument.findUnique({ where: { key: keyFor(businessId, id, offset / limit) } }))?.data;
  if (!chunk && manifest.count) throw fail(410, 'EXPORT_EXPIRED', 'Export snapshot is incomplete; start a new snapshot');
  const rows = chunk?.rows || [], next = offset + rows.length, more = next < manifest.count;
  return { status: 200, body: { ...manifest.envelope, items: rows, data: rows, count: rows.length,
    meta: { ...manifest.envelope.meta, snapshot: { id, created_at: manifest.created_at, expires_at: manifest.expires_at, count: manifest.count },
      pagination: { strategy: 'frozen-snapshot-v1', limit, offset, next_offset: next, has_more: more,
        complete_scope: Object.entries(filters).every(([key, value]) => scopeKeys.has(key) || value === '' || value === null),
        next_cursor: more ? token(id, next) : null } } } };
}

export async function cleanupExpiredSnapshots() {
  const rows = await prisma.stateDocument.findMany({ where: { key: { startsWith: 'export-snapshot:' }, data: { path: ['expires_at'], lte: new Date().toISOString() } }, select: { key: true }, take: 500 });
  if (rows.length) await prisma.stateDocument.deleteMany({ where: { key: { in: rows.map(row => row.key) } } });
  const jobs = await prisma.backgroundJob.findMany({ where: { type: TYPE, status: { in: ['completed', 'failed'] }, updatedAt: { lt: new Date(Date.now() - TTL) }, NOT: { payload: { path: ['filters'], equals: {} } } }, take: 100 });
  for (const job of jobs) if (Object.keys(job.payload.filters || {}).length) {
    await prisma.backgroundJob.updateMany({ where: { id: job.id, updatedAt: job.updatedAt }, data: { payload: { ...job.payload, filters: {} } } });
  }
  return rows.length;
}
