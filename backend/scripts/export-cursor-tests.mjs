import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_CURSOR, beginExportCursor, readExportPage, finishExportCursor } from '../src/shared/utils/export-cursor.js';

const business = { id: 'a', tenantId: 'tenant-a' }, secret = 'isolated-export-signing-key';
const begin = (query = {}, extra = {}) => beginExportCursor({ business, resource: 'tips', query, limit: 1, offset: 0, secret, ...extra });
const delegate = (rows, idField = 'id') => {
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(part => matches(row, part));
    if (value && typeof value === 'object') return Object.entries(value).every(([operator, bound]) => operator === 'gt' ? row[key] > bound : operator === 'lte' ? row[key] <= bound : operator === 'startsWith' ? row[key].startsWith(bound) : false);
    return row[key] === value;
  });
  const ordered = (where, reverse = false) => rows.filter(row => matches(row, where)).sort((a, b) => a[idField] < b[idField] ? (reverse ? 1 : -1) : a[idField] > b[idField] ? (reverse ? -1 : 1) : 0);
  return {
    findFirst: async args => ordered(args.where, args.orderBy[idField] === 'desc')[0] || null,
    findMany: async args => ordered(args.where).slice(args.skip || 0, (args.skip || 0) + args.take),
  };
};

test('deleting an earlier row and editing a later row cannot skip that later row', async () => {
  const rows = ['a', 'b', 'c'].map(id => ({ id, businessId: 'a', name: id }));
  const model = delegate(rows), args = { where: { businessId: 'a' }, take: 1, skip: 0 };
  let context = begin();
  assert.equal((await readExportPage(model, args, { [EXPORT_CURSOR]: context }))[0].id, 'a');
  let page = finishExportCursor(context);
  rows.shift(); rows[0].name = 'Updated during export'; rows.push({ id: 'z', businessId: 'a' });
  context = begin({ cursor: page.next_cursor }, { offset: page.next_offset });
  const second = await readExportPage(model, args, { [EXPORT_CURSOR]: context });
  assert.equal(second[0].id, 'b'); assert.equal(second[0].name, 'Updated during export');
  page = finishExportCursor(context);
  context = begin({ cursor: page.next_cursor }, { offset: page.next_offset });
  assert.equal((await readExportPage(model, args, { [EXPORT_CURSOR]: context }))[0].id, 'c');
  assert.equal(finishExportCursor(context).has_more, false, 'New rows beyond the original bound belong to the next export');
});

test('continuations reject tampering, a different tenant/resource/filter, expiry and skipped pages', async () => {
  const context = begin();
  await readExportPage(delegate([{ id: 'a' }, { id: 'b' }]), { take: 1 }, { [EXPORT_CURSOR]: context });
  const page = finishExportCursor(context), query = { cursor: page.next_cursor };
  for (const extra of [{ business: { id: 'other', tenantId: 'other' } }, { resource: 'payroll' }, { offset: 2 }, { now: Date.now() + 16 * 60000 }]) {
    assert.throws(() => begin(query, { offset: 1, ...extra }), error => error.code === 'EXPORT_CURSOR_INVALID');
  }
  assert.throws(() => begin({ ...query, status: 'active' }, { offset: 1 }), /scope or page changed/);
  assert.throws(() => begin({ cursor: page.next_cursor + 'x' }, { offset: 1 }), /Invalid export continuation/);
  const [payload, signed] = page.next_cursor.split('.');
  assert.throws(() => begin({ cursor: `${payload}.${'é'.repeat(signed.length)}` }, { offset: 1 }), error => error.code === 'EXPORT_CURSOR_INVALID');
  assert.throws(() => begin({}, { offset: 1 }), /required after the first page/);
});

test('grouped exports maintain separate positions without repeating smaller groups', async () => {
  const first = delegate([{ id: 'a1' }, { id: 'a2' }]), second = delegate([{ id: 'b1' }]);
  let context = begin();
  await readExportPage(first, { take: 1 }, { [EXPORT_CURSOR]: context }, { group: 'first' });
  await readExportPage(second, { take: 1 }, { [EXPORT_CURSOR]: context }, { group: 'second' });
  const page = finishExportCursor(context, { grouped: true });
  context = begin({ cursor: page.next_cursor }, { offset: page.next_offset });
  assert.equal((await readExportPage(first, { take: 1 }, { [EXPORT_CURSOR]: context }, { group: 'first' }))[0].id, 'a2');
  assert.deepEqual(await readExportPage(second, { take: 1 }, { [EXPORT_CURSOR]: context }, { group: 'second' }), []);
  assert.equal(finishExportCursor(context, { grouped: true }).has_more, false);
});

test('progress follows raw rows even when a projection filters every visible row', async () => {
  const context = begin({ status: 'active' });
  await readExportPage(delegate([{ id: 'a' }, { id: 'b' }]), { take: 1 }, { [EXPORT_CURSOR]: context });
  const page = finishExportCursor(context);
  assert.equal(page.has_more, true); assert.equal(page.next_offset, 1);
  assert.equal(page.complete_scope, false, 'Filtered results cannot infer absent business records');
});

test('state-document keys can advance without relying on mutable timestamps', async () => {
  const model = delegate([{ key: 'assistance:a:1' }, { key: 'assistance:a:2' }], 'key');
  let context = begin();
  await readExportPage(model, { where: { key: { startsWith: 'assistance:a:' } }, take: 1 }, { [EXPORT_CURSOR]: context }, { idField: 'key' });
  const page = finishExportCursor(context);
  context = begin({ cursor: page.next_cursor }, { offset: 1 });
  assert.equal((await readExportPage(model, { take: 1 }, { [EXPORT_CURSOR]: context }, { idField: 'key' }))[0].key, 'assistance:a:2');
});
