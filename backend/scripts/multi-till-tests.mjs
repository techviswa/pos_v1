import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/database/prisma/client.js';
import { saasService } from '../src/core/saas/saas.service.js';
import { billingService } from '../src/core/billing/billing.service.js';

const businessId = 'multi-till-' + randomUUID(), tenantId = 'tenant-' + businessId;
try {
  const email = `${businessId}@example.invalid`;
  await saasService.upsertTenantFromAdminCore({ business_id: businessId, tenant_id: tenantId, name: 'Isolated two-till acceptance',
    plan: 'growth', owner_email: email, owner_password: randomUUID() });
  const owner = await prisma.user.findFirstOrThrow({ where: { businessId, email } });
  const user = { id: owner.id, name: owner.name, role: 'Owner' };
  const product = await prisma.product.create({ data: { businessId, name: 'Last fixture unit', category: 'Fixture', price: 10, stock: 1 } });
  const payloads = [0, 1].map(index => ({ client_request_id: `${businessId}-till-${index}`, offline_created_at: new Date().toISOString(),
    items: [{ productId: product.id, quantity: 1, name: product.name, price: 1 }], gst_rate: 0, payment_type: 'Due' }));
  const create = payload => billingService.createInvoice({ tenantId, user, payload });
  const attempts = await Promise.allSettled(payloads.map(create));
  assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1, 'Only one till can sell the last unit');
  assert.equal(await prisma.bill.count({ where: { businessId } }), 1);
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).stock, 0);
  const winner = attempts.findIndex(row => row.status === 'fulfilled'), loser = winner === 0 ? 1 : 0;
  const first = attempts[winner].value;
  assert.equal(first.total, 10, 'Offline caller prices are not trusted');
  assert.equal((await create(payloads[winner])).id, first.id, 'Acknowledgement loss must replay even when stock is now zero');
  // Fixture restocking and a catalogue price change simulate manager review.
  await prisma.product.update({ where: { id: product.id }, data: { stock: 1, price: 20 } });
  const recovered = await create(payloads[loser]);
  assert.equal(recovered.total, 20, 'A previously refused offline receipt is re-priced on successful retry');
  assert.equal((await create(payloads[loser])).id, recovered.id);
  assert.equal((await create(payloads[winner])).total, 10, 'A replay cannot re-price an already accepted invoice');
  assert.equal(await prisma.bill.count({ where: { businessId } }), 2);
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).stock, 0);
  const bills = await prisma.bill.findMany({ where: { businessId } });
  assert.equal(bills.reduce((sum, bill) => sum + bill.total, 0), 30);
  console.log('Two-till acceptance passed: last-unit conflict, no negative stock, acknowledgement replay, explicit recovery, server repricing and unchanged accepted invoices');
} finally {
  const users = await prisma.user.findMany({ where: { businessId }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
  await prisma.backgroundJob.deleteMany({ where: { payload: { path: ['business_id'], equals: businessId } } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: businessId } } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
  await prisma.business.deleteMany({ where: { id: businessId } });
  await prisma.$disconnect();
}
