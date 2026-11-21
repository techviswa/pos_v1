import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createHttpError } from './http-error.js';

// Only bridge exports receive this symbol. Native screen queries retain their paging.
export const EXPORT_CURSOR = Symbol('admincore-export-cursor');
const TTL_MS = 15 * 60 * 1000;
const transportKeys = new Set(['cursor', 'offset', 'page', 'limit']);
const scopeKeys = new Set(['business_id', 'businessId', 'tenant_id', 'tenantId']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fail = message => createHttpError({ statusCode: 409, code: 'EXPORT_CURSOR_INVALID', message });
const signature = (encoded, secret) => createHmac('sha256', secret).update(encoded).digest('base64url');

export function beginExportCursor({ business, resource, query, limit, offset, secret, now = Date.now() }) {
  const filters = Object.fromEntries(Object.entries(query).filter(([key]) => !transportKeys.has(key)));
  const identity = { business: business.id, tenant: business.tenantId, resource, limit,
    filters: createHash('sha256').update(JSON.stringify(canonical(filters))).digest('hex') };
  let state = { ...identity, issued: now, offset: 0, positions: {}, bounds: {} };
  if (query.cursor) {
    if (typeof query.cursor !== 'string' || query.cursor.length > 8192) throw fail('Invalid export continuation');
    const parts = query.cursor.split('.');
    if (parts.length !== 2) throw fail('Invalid export continuation');
    const expected = signature(parts[0], secret);
    const suppliedSignature = Buffer.from(parts[1]);
    const expectedSignature = Buffer.from(expected);
    if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) throw fail('Invalid export continuation');
    try { state = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
    catch { throw fail('Invalid export continuation'); }
    if (Object.entries(identity).some(([key, value]) => state[key] !== value) || state.offset !== offset) throw fail('Export scope or page changed; restart from the first page');
    if (!Number.isSafeInteger(state.issued) || state.issued > now + 60000 || now - state.issued > TTL_MS) throw fail('Export continuation expired; restart from the first page');
    for (const map of [state.positions, state.bounds]) {
      if (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some(value => value !== null && (typeof value !== 'string' || value.length > 500))) throw fail('Invalid export continuation');
    }
  } else if (offset !== 0) {
    throw fail('Export continuation is required after the first page');
  }
  const completeScope = Object.entries(filters).every(([key, value]) => scopeKeys.has(key) || value === undefined || value === null || value === '');
  return { state, secret, completeScope, reads: {} };
}

export async function readExportPage(delegate, args, query = {}, { group = 'default', idField = 'id' } = {}) {
  const context = query[EXPORT_CURSOR];
  if (!context) return delegate.findMany(args);
  const { state } = context;
  if (!Object.hasOwn(state.bounds, group)) {
    const last = await delegate.findFirst({ where: args.where, select: { [idField]: true }, orderBy: { [idField]: 'desc' } });
    state.bounds[group] = last?.[idField] ?? null;
  }
  const bound = state.bounds[group];
  if (bound === null) {
    context.reads[group] = { count: 0, last: null };
    return [];
  }
  const position = state.positions[group];
  const rows = await delegate.findMany({ ...args, where: { AND: [args.where || {}, { [idField]: { lte: bound, ...(position ? { gt: position } : {}) } }] },
    orderBy: { [idField]: 'asc' }, skip: 0, take: state.limit });
  context.reads[group] = { count: rows.length, last: rows.at(-1)?.[idField] ?? null };
  return rows;
}

export function finishExportCursor(context, { grouped = false } = {}) {
  const positions = { ...context.state.positions };
  for (const [group, read] of Object.entries(context.reads)) {
    if (read.last) positions[group] = read.last;
  }
  const hasMore = Object.entries(context.reads).some(([group, read]) => read.count === context.state.limit && read.last !== context.state.bounds[group]);
  const consumed = Math.max(0, ...Object.values(context.reads).map(read => read.count));
  const nextOffset = context.state.offset + (grouped ? context.state.limit : consumed);
  const state = { ...context.state, offset: nextOffset, positions };
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64url');
  return { strategy: 'bounded-id-v1', limit: state.limit, offset: context.state.offset, next_offset: nextOffset,
    has_more: hasMore, complete_scope: context.completeScope,
    next_cursor: hasMore ? `${encoded}.${signature(encoded, context.secret)}` : null };
}
