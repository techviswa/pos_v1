import assert from 'node:assert/strict';
import { serializeBill } from '../src/database/prisma/helpers.js';

const bill = { id: 'bill', businessId: 'business', business: { tenantId: 'tenant' }, invoiceNumber: 'INV-OFFICIAL', customerName: 'Guest', currency: 'USD', subtotal: 0, tax: 0, total: 0, status: 'issued', metadata: { id: 'stale-id', total: 900, currency: 'INR', invoice_number: 'OLD', notes: 'Preserved note' } };
const result = serializeBill(bill);
assert.equal(result.id, 'bill');
assert.equal(result.total, 0);
assert.equal(result.currency, 'USD');
assert.equal(result.invoice_number, 'INV-OFFICIAL');
assert.equal(result.notes, 'Preserved note');
assert.equal(serializeBill({ ...bill, invoiceNumber: null }).invoice_number, 'OLD');
console.log('Bill serialization: authoritative identity/amount/currency/invoice number and legacy metadata preserved');
