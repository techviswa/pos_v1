import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/database/prisma/client.js";
import { PaymentsService } from "../src/core/payments/payments.service.js";

const suffix = randomUUID();
const scopes = ["a", "b"].map((id) => ({ businessId: `payment-test-${suffix}-${id}`, tenantId: `payment-tenant-${suffix}-${id}` }));
const service = new PaymentsService();
try {
  for (const scope of scopes) {
    await prisma.business.create({ data: { id: scope.businessId, tenantId: scope.tenantId, name: "Payment isolation test" } });
  }
  const [a, b] = scopes;
  const intent = await service.createIntent({ ...a, payload: { amount: 30, status: "confirmed" } });
  assert.equal(intent.status, "pending");
  assert.equal(intent.business_id, a.businessId);
  const restarted = new PaymentsService();
  assert.equal((await restarted.getIntent(intent.id, a)).id, intent.id);
  assert.equal(await restarted.getIntent(intent.id, b), null);
  assert.equal(await service.confirmIntent({ ...b, intentId: intent.id }), null);
  assert.deepEqual(await service.listIntents(b), []);
  await assert.rejects(service.listIntents({}), (error) => error.statusCode === 403);
  await assert.rejects(service.listIntents({ ...a, tenantId: b.tenantId }), (error) => error.statusCode === 403);
  await assert.rejects(service.createIntent({ ...a, payload: { amount: -1 } }), (error) => error.statusCode === 400);
  await assert.rejects(service.createIntent({ ...a, payload: { amount: 1, invoice_id: "unowned-invoice" } }), (error) => error.statusCode === 404);
  await assert.rejects(service.createIntent({ publicRequest: true, payload: { amount: 1 } }), (error) => error.statusCode === 503);
  assert.throws(() => service.recordWebhook({ payload: { intent_id: intent.id, status: "confirmed" } }), (error) => error.statusCode === 503);
  const confirmations = await Promise.all([
    service.confirmIntent({ ...a, intentId: intent.id }),
    restarted.confirmIntent({ ...a, intentId: intent.id }),
  ]);
  assert.ok(confirmations.every((result) => result.status === "confirmed"));
  await assert.rejects(service.confirmIntent({ ...a, intentId: intent.id, payload: { status: "failed" } }), (error) => error.statusCode === 409);
  assert.equal((await service.listIntents(a)).length, 1);
  console.log("Payment persistence, scope, replay, concurrency and public confirmation guards passed");
} finally {
  for (const scope of scopes) {
    await prisma.stateDocument.deleteMany({ where: { key: { startsWith: `payment-intent:${encodeURIComponent(scope.businessId)}:` } } });
    await prisma.business.deleteMany({ where: { id: scope.businessId } });
  }
  await prisma.$disconnect();
}
