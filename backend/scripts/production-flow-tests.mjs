import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { connectDatabase } from "../src/config/db.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { authService } from "../src/core/auth/auth.service.js";
import { kotService } from "../src/features/kitchen/kot/kot.service.js";
import { printerService } from "../src/services/printer/printer.service.js";
import { DurableJobQueue } from "../src/services/jobs/durable-job-queue.js";

const id = `test-${randomUUID()}`;
const tenantId = `${id}-tenant`;
const original = env.nodeEnv;
const enabled = env.admincore.enabled;
const password = `Test-${randomUUID()}`;
try {
  await connectDatabase();
  env.nodeEnv = "production";
  env.admincore.enabled = false;
  const provision = { business_id: id, tenant_id: tenantId, name: "Production regression fixture", plan: "growth", owner_email: `${id}@example.invalid`, owner_password: password };
  await saasService.upsertTenantFromAdminCore(provision);
  await saasService.upsertTenantFromAdminCore(provision);
  assert.equal(await prisma.business.count({ where: { id } }), 1);
  assert.equal(await prisma.user.count({ where: { businessId: id } }), 1);
  await assert.rejects(saasService.upsertTenantFromAdminCore({ ...provision, business_id: `${id}-wrong` }), /map to different/);
  const login = await authService.login({ email: provision.owner_email, password });
  assert.ok(login?.sessionId);
  assert.equal((await authService.getCurrentUser({ sessionId: login.sessionId })).business_id, id);
  assert.equal(await prisma.authSession.count({ where: { userId: login.user.id } }), 1);
  await authService.logout({ sessionId: login.sessionId });
  assert.equal(await authService.getCurrentUser({ sessionId: login.sessionId }), null);

  const payload = { items: [{ name: "Test meal", quantity: 1, price: 100 }], gst_rate: 0, payment_type: "Due", invoice_number: "FORGED", invoice_sequence: 999 };
  const bills = await Promise.all(Array.from({ length: 4 }, () => billingService.createInvoice({ tenantId, payload })));
  assert.equal(new Set(bills.map((bill) => bill.invoice_number)).size, 4);
  assert.ok(bills.every((bill) => bill.invoice_number !== "FORGED" && bill.due_amount === 100));
  const bill = bills[0];
  const user = { id: login.user.id, role: "Owner" };
  await Promise.all([30, 40].map((amount) => billingService.addPayment({ tenantId, invoiceId: bill.id, payload: { amount, method: "Cash" }, user })));
  const partial = await billingService.getInvoiceById({ tenantId, invoiceId: bill.id });
  assert.equal(partial.paid_amount, 70);
  assert.equal(partial.due_amount, 30);
  const refunds = await Promise.allSettled([50, 50].map((amount) => billingService.refundInvoice({ tenantId, invoiceId: bill.id, payload: { amount, method: "Cash", reason: "Regression test" }, user })));
  assert.equal(refunds.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal((await billingService.getInvoiceById({ tenantId, invoiceId: bill.id })).refunded_amount, 50);

  const order = await prisma.order.create({ data: { businessId: id, customerName: "Test", channel: "pos", status: "accepted", items: { create: [{ name: "Test meal", quantity: 1, price: 100 }] } } });
  const tickets = await Promise.all([1, 2].map(() => kotService.ensureTicketForOrder({ businessId: id, orderId: order.id })));
  assert.equal(tickets[0].id, tickets[1].id);
  assert.equal(await prisma.kitchenTicket.count({ where: { businessId: id } }), 1);

  const print = await printerService.queuePrintJob({ businessId: id, payload: { test: true } });
  const claims = await Promise.all(["one", "two"].map((agentId) => printerService.claimNextPrintJob({ businessId: id, agentId })));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await printerService.getPrintJob(print.id, "another-business"), null);

  const queue = new DurableJobQueue();
  const job = await queue.enqueue(id, { fixture: true });
  const restarted = new DurableJobQueue();
  restarted.registerHandler(id, async () => ({ handled: true }));
  assert.equal((await restarted.runNext()).id, job.id);
  assert.equal((await restarted.get(job.id)).status, "completed");
  console.log("Production DB flows passed: provisioning replay/conflict, sessions, concurrent invoices/payments/refunds/KOT, printer claims, durable jobs.");
} finally {
  env.nodeEnv = original;
  env.admincore.enabled = enabled;
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.business.deleteMany({ where: { id } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } });
  await prisma.documentSequence.deleteMany({ where: { key: { contains: id } } });
  await prisma.backgroundJob.deleteMany({ where: { type: id } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
  await prisma.$disconnect();
}
