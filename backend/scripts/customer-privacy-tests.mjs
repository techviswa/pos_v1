import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/database/prisma/client.js';
import { customersService } from '../src/core/customers/customers.service.js';
import { admincoreChangeSyncService } from '../src/core/admincore/admincore-change-sync.service.js';
import { syncService } from '../src/core/sync/sync.service.js';
import { runTenantScope } from '../src/database/prisma/tenant-context.js';

const businessId = 'privacy-' + randomUUID(), tenantId = 'tenant-' + businessId;
const otherId = 'other-' + businessId;
const notify = admincoreChangeSyncService.notifyChange;
try {
  await prisma.business.create({ data: { id: businessId, tenantId, name: 'Isolated privacy acceptance' } });
  await prisma.business.create({ data: { id: otherId, tenantId: 'tenant-' + otherId, name: 'Other isolated scope' } });
  const customer = await prisma.customer.create({ data: { businessId, phone: '919876543210', name: 'Private name', email: 'privacy@example.test' } });
  const bill = await prisma.bill.create({ data: { businessId, customerName: 'Private name', currency: 'INR', total: 123.45, status: 'paid',
    metadata: { customer_phone: '+91 98765 43210', customer_email: 'privacy@example.test', customer_name: 'Private name', notes: 'private receipt note' } } });
  const order = await prisma.order.create({ data: { businessId, customerName: 'Private name', channel: 'dine-in', total: 12, status: 'completed',
    metadata: { customer_id: customer.id, customer_phone: '919876543210', customer_name: 'Private name' } } });
  await prisma.feedback.create({ data: { businessId, billId: bill.id, customerName: 'Private name', comment: 'private feedback', rating: 5 } });
  await prisma.bill.create({ data: { businessId: otherId, customerName: 'Other scope', currency: 'INR', total: 22, status: 'paid', metadata: { customer_phone: '919876543210' } } });
  // An unavailable outbox must roll the entire erasure back, rather than lose its sync barrier.
  admincoreChangeSyncService.notifyChange = async () => { throw new Error('simulated erasure outbox outage'); };
  await assert.rejects(() => runTenantScope({ businessId, tenantId }, () => customersService.anonymize({ businessId, customerId: customer.id, payload: { reason: 'Customer request' } })), /simulated erasure outbox outage/);
  assert.equal((await prisma.customer.findUnique({ where: { id: customer.id } })).anonymizedAt, null);
  assert.equal(await prisma.stateDocument.count({ where: { key: { startsWith: `privacy-erasure:${businessId}:` } } }), 0);
  admincoreChangeSyncService.notifyChange = notify;
  await runTenantScope({ businessId, tenantId }, () => customersService.anonymize({ businessId, customerId: customer.id, payload: { reason: 'Customer request' } }));
  const cleared = await prisma.bill.findUnique({ where: { id: bill.id } });
  assert.equal(cleared.total, 123.45); assert.equal(cleared.currency, 'INR');
  assert.equal(cleared.customerName, 'Erased customer'); assert.equal(cleared.metadata.customer_phone, null);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).metadata.customer_name, 'Erased customer');
  assert.equal((await prisma.feedback.findFirst({ where: { billId: bill.id } })).comment, null);
  assert.equal((await prisma.bill.findFirst({ where: { businessId: otherId } })).metadata.customer_phone, '919876543210');
  const exported = await runTenantScope({ businessId, tenantId }, () => syncService.exportResource({ resource: 'privacy-erasures', businessId, tenantId }));
  assert.equal(exported.items.length, 3); assert(exported.items.every(item => item.customer_id === customer.id));
  assert(!JSON.stringify(exported).includes('919876543210'));
  assert(!JSON.stringify(exported).includes('privacy@example.test'));
  console.log('Customer privacy passed: scoped receipt/order/feedback cleanup, preserved amounts, durable keyed markers, outbox rollback and real tenant export');
} finally {
  admincoreChangeSyncService.notifyChange = notify;
  await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `privacy-erasure:${businessId}:` } } });
  await prisma.stateDocument.deleteMany({ where: { key: `privacy-epoch:${businessId}` } });
  await prisma.backgroundJob.deleteMany({ where: { payload: { path: ['business_id'], equals: businessId } } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherId] } } });
  await prisma.$disconnect();
}
