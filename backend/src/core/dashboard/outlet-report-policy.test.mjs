import assert from 'node:assert/strict';
import { reportOutlets } from './outlet-report-policy.js';
const outlets = [
  { id: 'open', status: 'active' },
  { id: 'empty', status: 'inactive' },
  { id: 'closed-sales', status: 'inactive' },
  { id: 'refunded', status: 'archived' },
];
const history = new Set(['closed-sales', 'refunded']);
assert.deepEqual(reportOutlets(outlets, history).map(row => row.id), ['open', 'closed-sales', 'refunded']);
assert.deepEqual(reportOutlets(outlets, history, 'open').map(row => row.id), ['open']);
assert.deepEqual(reportOutlets(outlets, history, 'closed-sales').map(row => row.id), ['closed-sales']);
assert.deepEqual(reportOutlets(outlets, history, 'missing'), []);
assert.equal(outlets.length, 4);
console.log('Outlet report policy: inactive empty, historical, refunded, and selected scope passed');
