import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { connectDatabase } from "../src/config/db.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { authService } from "../src/core/auth/auth.service.js";
import { kotService } from "../src/features/kitchen/kot/kot.service.js";
import { summarizeKotTiming } from "../src/features/kitchen/kot/kot.utils.js";
import { aggregateKitchenStatus } from "../src/features/kitchen/kot/kot-workflow.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";
import { printerService } from "../src/services/printer/printer.service.js";
import { DurableJobQueue } from "../src/services/jobs/durable-job-queue.js";

const id = `test-${randomUUID()}`;
const tenantId = `${id}-tenant`;
const original = env.nodeEnv;
const enabled = env.admincore.enabled;
const admincoreUrl = env.admincore.apiBaseUrl;
const password = `Test-${randomUUID()}`;
const server = http.createServer(app);
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
  const pendingInvoice = await billingService.createInvoice({ tenantId, payload: { ...payload,
    payments: [{ amount: 100, method: " upi ", status: "confirmed" }] } });
  assert.equal(pendingInvoice.paid_amount, 0);
  assert.equal(pendingInvoice.due_amount, 100);
  assert.equal(pendingInvoice.payments[0].status, "pending_confirmation");
  const confirmation = { tenantId, invoiceId: pendingInvoice.id, paymentId: pendingInvoice.payments[0].id,
    user: { id: login.user.id, role: "Owner" }, payload: { reference: "verified-test-reference" } };
  await assert.rejects(billingService.confirmPayment({ ...confirmation, payload: { reference: "   " } }), /reference is required/);
  const confirmed = await billingService.confirmPayment(confirmation);
  assert.equal(confirmed.paid_amount, 100);
  const replay = await billingService.confirmPayment(confirmation);
  assert.equal(replay.paid_amount, 100);
  await assert.rejects(billingService.confirmPayment({ ...confirmation, payload: { reference: "changed-reference" } }), /cannot be changed/);
  const fixtureBill = await prisma.bill.findUnique({ where: { id: pendingInvoice.id } });
  for (const status of ["failed", "cancelled"]) {
    await prisma.bill.update({ where: { id: pendingInvoice.id }, data: { metadata: {
      ...fixtureBill.metadata, payments: fixtureBill.metadata.payments.map((payment) => ({ ...payment, status })),
    } } });
    await assert.rejects(billingService.confirmPayment(confirmation), /cannot be confirmed/);
  }
  await assert.rejects(billingService.createInvoice({ tenantId, payload: { ...payload,
    payments: [{ amount: 101, method: "Cash" }] } }), /cannot exceed/);
  const bills = await Promise.all(Array.from({ length: 4 }, () => billingService.createInvoice({ tenantId, payload })));
  assert.equal(new Set(bills.map((bill) => bill.invoice_number)).size, 4);
  assert.ok(bills.every((bill) => bill.invoice_number !== "FORGED" && bill.due_amount === 100));
  const bill = bills[0];
  const user = { id: login.user.id, role: "Owner" };
  for (const forbidden of ["payments", "due_amount", "payment_status", "void_approved_by", "outlet_id", "orderId", "currency", "gst_breakup", "created_by", "total", "items", "feedback_token", "feedback_link"]) {
    await assert.rejects(billingService.updateInvoice({ tenantId, invoiceId: bill.id, payload: { [forbidden]: "forged" } }), /immutable/);
  }
  await assert.rejects(billingService.deleteInvoice({ tenantId, invoiceId: bill.id }), /retained for audit/);
  assert.equal(await prisma.bill.count({ where: { id: bill.id, businessId: id } }), 1);
  const editCandidate = bills[1];
  await Promise.all([
    billingService.updateInvoice({ tenantId, invoiceId: editCandidate.id, payload: { kitchen_status: "preparing", notes: "No onions" } }),
    billingService.addPayment({ tenantId, invoiceId: editCandidate.id, payload: { amount: 40, method: "Cash" }, user }),
  ]);
  const edited = await billingService.getInvoiceById({ tenantId, invoiceId: editCandidate.id });
  assert.equal(edited.paid_amount, 40);
  assert.equal(edited.due_amount, 60);
  assert.equal(edited.notes, "No onions");
  assert.equal(edited.total, 100);
  assert.equal(edited.invoice_number, editCandidate.invoice_number);
  assert.equal(edited.kitchen_status, "preparing");
  const apiLogin = await authService.login({ email: provision.owner_email, password });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  for (const route of [`/api/bills/${bill.id}`, `/api/bills/${bill.id}/kitchen-status`, `/api/billing/${bill.id}`]) {
    const response = await fetch(`${apiUrl}${route}`, { method: "PUT",
      headers: { "Content-Type": "application/json", "x-cf-session-id": apiLogin.sessionId },
      body: JSON.stringify({ due_amount: 0, payment_status: "paid" }),
    });
    assert.equal(response.status, 409, `${route}: ${await response.text()}`);
  }
  const kitchenResponse = await fetch(`${apiUrl}/api/bills/${editCandidate.id}/kitchen-status`, { method: "PUT",
    headers: { "Content-Type": "application/json", "x-cf-session-id": apiLogin.sessionId },
    body: JSON.stringify({ kitchen_status: "ready" }),
  });
  assert.equal(kitchenResponse.status, 200, await kitchenResponse.text());
  assert.equal((await billingService.getInvoiceById({ tenantId, invoiceId: editCandidate.id })).paid_amount, 40);
  const ownerRecord = await prisma.user.findUniqueOrThrow({ where: { id: login.user.id } });
  const cashierRole = await prisma.role.findUniqueOrThrow({ where: { name: "Cashier" } });
  const restrictedUser = await prisma.user.create({ data: { businessId: id, roleId: cashierRole.id,
    name: "Revoked billing fixture", email: `${id}-restricted@example.invalid`, passwordHash: ownerRecord.passwordHash } });
  const restrictedLogin = await authService.login({ email: restrictedUser.email, password });
  for (const [method, route, body] of [
    ["POST", "/api/bills", payload],
    ["PUT", `/api/bills/${bill.id}`, { notes: "Not permitted" }],
    ["PUT", `/api/bills/${bill.id}/kitchen-status`, { kitchen_status: "served" }],
    ["DELETE", `/api/bills/${bill.id}`, undefined],
  ]) {
    const response = await fetch(`${apiUrl}${route}`, { method,
      headers: { "Content-Type": "application/json", "x-cf-session-id": restrictedLogin.sessionId },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 403, `${method} ${route}: ${await response.text()}`);
  }
  await assert.rejects(billingService.updateInvoice({ tenantId: `${tenantId}-other`, invoiceId: editCandidate.id, payload: { notes: "Wrong tenant" } }));
  const voidCandidate = await billingService.createInvoice({ tenantId, payload });
  const voidRequest = { tenantId, invoiceId: voidCandidate.id, user };
  await assert.rejects(billingService.approveVoid(voidRequest), /No pending/);
  await billingService.requestVoid({ ...voidRequest, reason: "Duplicate order" });
  await assert.rejects(billingService.approveVoid({ ...voidRequest, user: { ...user, role: "Cashier" } }), /Manager approval/);
  const voidRace = await Promise.allSettled([
    billingService.approveVoid(voidRequest),
    billingService.addPayment({ ...voidRequest, payload: { amount: 100, method: "Cash" } }),
  ]);
  assert.equal(voidRace.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const racedInvoice = await billingService.getInvoiceById({ tenantId, invoiceId: voidCandidate.id });
  assert.ok(racedInvoice.status === "void" ? racedInvoice.paid_amount === 0 : racedInvoice.paid_amount === 100);
  await Promise.all([30, 40].map((amount) => billingService.addPayment({ tenantId, invoiceId: bill.id, payload: { amount, method: "Cash" }, user })));
  const partial = await billingService.getInvoiceById({ tenantId, invoiceId: bill.id });
  assert.equal(partial.paid_amount, 70);
  assert.equal(partial.due_amount, 30);
  const refunds = await Promise.allSettled([50, 50].map((amount) => billingService.refundInvoice({ tenantId, invoiceId: bill.id, payload: { amount, method: "Cash", reason: "Regression test" }, user })));
  assert.equal(refunds.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal((await billingService.getInvoiceById({ tenantId, invoiceId: bill.id })).refunded_amount, 50);

  const order = await prisma.order.create({ data: { businessId: id, customerName: "Test", channel: "pos", status: "accepted", items: { create: [{ name: "Test meal", quantity: 1, price: 100 }, { name: "Test coffee", quantity: 1, price: 30 }] } } });
  const tickets = await Promise.all([1, 2].map(() => kotService.ensureTicketForOrder({ businessId: id, orderId: order.id })));
  assert.equal(tickets[0].id, tickets[1].id);
  assert.equal(await prisma.kitchenTicket.count({ where: { businessId: id } }), 1);
  const ticketId = tickets[0].id;
  assert.equal(summarizeKotTiming({ created_at: new Date(Date.now() - 30 * 60000).toISOString(), estimated_prep_minutes: 20 }).sla_status, "breached");
  assert.equal(aggregateKitchenStatus([{ status: "rejected" }, { status: "rejected" }]), "rejected");
  const ticketItems = tickets[0].order.metadata.kot.items;
  const auditBefore = (await kotService.getHistory({ tenantId, ticketId })).audit.length;
  await assert.rejects(kotService.markReady({ tenantId, ticketId, actor: user }), /preparation|Cannot move/);
  await assert.rejects(kotService.updateItemStatus({ tenantId, ticketId, itemId: "missing", status: "accepted", actor: user }), /not found/);
  await assert.rejects(kotService.updateItemStatus({ tenantId, ticketId, itemId: ticketItems[0].item_id, status: "served", actor: { ...user, role: "Chef" } }), /role cannot/);
  await Promise.all(ticketItems.map((item) => kotService.updateItemStatus({ tenantId, ticketId, itemId: item.item_id, status: "accepted", actor: user })));
  const updatedTicket = kotService.serializeTicket(await kotService.getTicket({ tenantId, ticketId }));
  assert.ok(updatedTicket.items.every((item) => item.status === "accepted"));
  assert.equal(updatedTicket.audit.length, auditBefore + 2);
  env.admincore.enabled = true;
  env.admincore.apiBaseUrl = "https://admincore.example.invalid";
  const preparingTicket = await kotService.startPrep({ tenantId, ticketId, actor: user });
  const jobScope = { type: "admincore.notify-change", payload: { path: ["tenant_id"], equals: tenantId } };
  const kitchenJob = await prisma.backgroundJob.findFirstOrThrow({ where: jobScope });
  assert.equal(kitchenJob.payload.resource, "orders");
  assert.equal(kitchenJob.payload.record_id, order.id);
  assert.equal(kitchenJob.payload.business_id, id);
  assert.equal(kitchenJob.payload.metadata.kitchen_status, "preparing");
  const logCount = await prisma.adminCoreSyncLog.count({ where: { tenantId } });
  await assert.rejects(prisma.$transaction(async (tx) => {
    await admincoreChangeSyncService.notifyChange({ resource: "orders", tenantId, businessId: id, recordId: order.id }, { tx });
    throw new Error("Simulated transaction rollback");
  }), /Simulated transaction rollback/);
  assert.equal(await prisma.backgroundJob.count({ where: jobScope }), 1);
  assert.equal(await prisma.adminCoreSyncLog.count({ where: { tenantId } }), logCount);
  env.admincore.enabled = false;
  const replayedTicket = kotService.serializeTicket(await kotService.ensureTicketForOrder({ businessId: id, orderId: order.id }));
  assert.equal(replayedTicket.prep_started_at, preparingTicket.prep_started_at);
  assert.equal(replayedTicket.ticket_number, preparingTicket.ticket_number);
  assert.ok(replayedTicket.items.every((item) => item.status === "preparing"));
  await assert.rejects(kotService.acceptTicket({ tenantId, ticketId, actor: user }), /Cannot move/);
  await kotService.updateItemStatus({ tenantId, ticketId, itemId: ticketItems[0].item_id, status: "ready", actor: user });
  const readyTicket = await kotService.updateItemStatus({ tenantId, ticketId, itemId: ticketItems[1].item_id, status: "ready", actor: user });
  assert.equal(readyTicket.status, "ready");
  assert.ok(readyTicket.ready_at);
  const pickupResponse = await fetch(`${apiUrl}/api/kot?status=ready`, { headers: { "x-cf-session-id": apiLogin.sessionId } });
  assert.equal(pickupResponse.status, 200);
  assert.ok((await pickupResponse.json()).data.items.some((item) => item.id === ticketId));
  const mixedTicket = await kotService.updateItemStatus({ tenantId, ticketId, itemId: ticketItems[0].item_id, status: "served", actor: { ...user, role: "Waiter" } });
  assert.equal(mixedTicket.status, "ready");
  const completedTicket = await kotService.completeService({ tenantId, ticketId, actor: user });
  assert.equal(completedTicket.status, "completed");
  assert.ok(completedTicket.items.every((item) => item.status === "served"));
  assert.equal((await kotService.completeService({ tenantId, ticketId, actor: user })).audit.length, completedTicket.audit.length);
  await assert.rejects(kotService.startPrep({ tenantId, ticketId, actor: user }), /Cannot move/);
  const pendingQr = await prisma.order.create({ data: { businessId: id, customerName: "QR fixture", channel: "qr", status: "qr_pending_approval", metadata: { approval_status: "pending" } } });
  await assert.rejects(kotService.ensureTicketForOrder({ businessId: id, orderId: pendingQr.id }), /Restaurant approval/);
  assert.equal(await prisma.kitchenTicket.count({ where: { orderId: pendingQr.id } }), 0);

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
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  env.nodeEnv = original;
  env.admincore.enabled = enabled;
  env.admincore.apiBaseUrl = admincoreUrl;
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.business.deleteMany({ where: { id } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } });
  await prisma.documentSequence.deleteMany({ where: { key: { contains: id } } });
  await prisma.backgroundJob.deleteMany({ where: { type: id } });
  await prisma.backgroundJob.deleteMany({ where: { type: "admincore.notify-change", payload: { path: ["tenant_id"], equals: tenantId } } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId } });
  await prisma.$disconnect();
}
