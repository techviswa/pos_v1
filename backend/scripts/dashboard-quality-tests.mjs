import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../src/database/prisma/client.js';
import { connectDatabase } from '../src/config/db.js';
import { dashboardService } from '../src/core/dashboard/dashboard.service.js';
import { dashboardController } from '../src/core/dashboard/dashboard.controller.js';

await assert.rejects(dashboardService.getStats({ tenantId: 'not-connected' }), error => error.statusCode === 503);
const id = `dashboard-quality-${randomUUID()}`, other = `${id}-other`, tenantId = `tenant-${id}`;
try {
  await connectDatabase();
  await prisma.business.create({ data: { id, tenantId, name: 'Isolated dashboard quality fixture' } });
  await prisma.business.create({ data: { id: other, tenantId: `tenant-${other}`, name: 'Foreign fixture' } });
  const a = await prisma.outlet.create({ data: { businessId: id, name: 'A', code: 'A' } });
  const b = await prisma.outlet.create({ data: { businessId: id, name: 'B', code: 'B' } });
  const foreign = await prisma.outlet.create({ data: { businessId: other, name: 'Foreign', code: 'F' } });
  const ingredient = await prisma.inventoryItem.create({ data: { businessId: id, name: 'Flour', stock: 100, unit: 'kg', reorderLevel: 5 } });
  await prisma.outletInventory.createMany({ data: [
    { outletId: a.id, inventoryItemId: ingredient.id, stock: 3, reorderLevel: 5 },
    { outletId: b.id, inventoryItemId: ingredient.id, stock: 80, reorderLevel: 5 },
  ] });
  await prisma.bill.createMany({ data: [
    { businessId: id, customerName: 'A fixture', currency: 'INR', subtotal: 7, total: 7, status: 'paid', metadata: { outlet_id: a.id } },
    { businessId: id, customerName: 'B fixture', currency: 'INR', subtotal: 11, total: 11, status: 'paid', metadata: { outlet_id: b.id } },
  ] });
  const first = await dashboardService.getStats({ tenantId, outletId: a.id });
  const second = await dashboardService.getStats({ tenantId, outletId: b.id });
  assert.equal(first.overview.total_sales, 7);
  assert.equal(second.overview.total_sales, 11);
  assert.deepEqual(first.outlets.map(row => row.outlet_id), [a.id]);
  assert.equal(first.inventoryAlerts[0].stock, 3);
  assert.equal(second.inventoryAlerts.length, 0);
  assert.equal((await dashboardService.getStats({ tenantId })).overview.total_sales, 18);
  await assert.rejects(dashboardService.getStats({ tenantId, outletId: foreign.id }), error => error.code === 'REFERENCE_NOT_IN_BUSINESS');
  await assert.rejects(dashboardController.stats({ context: { tenantId, outletScope: [a.id] }, query: { outlet_id: b.id } }, {}), error => error.statusCode === 403);
  console.log('Dashboard quality: unavailable data, separate outlet caches, local stock, totals, foreign outlet and staff scope passed');
} finally {
  await prisma.business.deleteMany({ where: { id: { in: [id, other] } } });
  await prisma.$disconnect();
}
