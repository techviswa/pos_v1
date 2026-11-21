import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeCustomerRows } from '../src/core/sync/customer-export.js';
const scope = { businessId: 'a', tenantId: 't' };
const bill = (total, extra = {}) => ({ id: 'b', customerName: 'Person', total, currency: 'INR', status: 'paid', metadata: { customer_phone: '9876543210' }, ...extra });
test('billed orders cannot double-count spend or order count', () => {
  const [row] = serializeCustomerRows({ ...scope, bills: [bill(100, { order_id: 'order', refunded_amount: 25 })],
    orders: [{ id: 'order', customerName: 'Person', total: 100, metadata: { customer_phone: '9876543210' } }] });
  assert.equal(row.total_spent, 75); assert.equal(row.order_count, 1); assert.equal(row.bill_count, 1);
});
test('decimals, full refunds, voids and mixed currencies stay explicit', () => {
  assert.equal(serializeCustomerRows({ ...scope, bills: [bill(.1), bill(.2)] })[0].total_spent, .3);
  assert.equal(serializeCustomerRows({ ...scope, bills: [bill(10, { refunded_amount: 10 })] })[0].total_spent, 0);
  assert.equal(serializeCustomerRows({ ...scope, bills: [bill(10, { status: 'void' })] }).length, 0);
  const [mixed] = serializeCustomerRows({ ...scope, bills: [bill(10), bill(20, { currency: 'USD' })] });
  assert.equal(mixed.total_spent, null); assert.equal(mixed.total_spent_by_currency.length, 2);
});
test('names do not merge unrelated anonymous receipts and erased rows cannot recreate customers', () => {
  assert.equal(serializeCustomerRows({ ...scope, bills: [bill(10, { metadata: {} })] }).length, 0);
  assert.equal(serializeCustomerRows({ ...scope, bills: [bill(10, { privacy_erased: true })] }).length, 0);
  assert.throws(() => serializeCustomerRows({ ...scope, bills: [bill('NaN')] }), error => error.code === 'CUSTOMER_INVOICE_INVALID');
});
