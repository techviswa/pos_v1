import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { productsService } from "../src/core/products/products.service.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { tableManagementService } from "../src/features/sales-extensions/table-management/table-management.service.js";
import { qrOrderingService } from "../src/features/sales-extensions/qr-ordering/qr-ordering.service.js";
import { guestProgress } from "../src/features/sales-extensions/qr-ordering/guest-progress.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const id = `qr-progress-${randomUUID()}`, tenantId = `tenant-${id}`;
const server = http.createServer(app), previous = env.admincore.enabled;
let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
try {
  env.admincore.enabled = false;
  await prisma.business.create({ data: { id, tenantId, name: "Progress fixture" } });
  await saasService.updateSubscription({ businessId: id, payload: { plan: "growth", subscription_status: "active" } });
  await prisma.tableManagementSettings.create({ data: { businessId: id, capabilities: { qrOrderingEnabled: true } } });
  const product = await productsService.createProduct({ tenantId, payload: { name: "Round item", category: "Food", price: 10, stock: 100 } });
  const table = await prisma.diningTable.create({ data: { businessId: id, name: "Rounds" } });
  const qr = await tableManagementService.upsertTableQrCode({ businessId: id, tenantId, tableId: table.id });
  const visit = (await qrOrderingService.getMenu({ token: qr.token })).table_session;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/public/qr`;
  const payload = { customer_name: "Guest", customer_phone: "9999999999", table_session_key: visit.session_key, table_session_opened_at: visit.opened_at, items: [{ product_id: product.id, quantity: 1 }] };
  const send = async (key) => {
    const response = await fetch(`${base}/${qr.token}/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, client_request_id: key }) });
    return { status: response.status, data: (await response.json()).data };
  };
  const first = await send("first"); eq(first.status, 201);
  eq((await send("first")).data.id, first.data.id);
  const second = await send("second"); eq(second.status, 201);
  assert.notEqual(first.data.id, second.data.id); checks++;
  eq(second.data.metadata.table_session_id, first.data.metadata.table_session_id);
  await prisma.order.update({ where: { id: first.data.id }, data: { status: "billed", metadata: { ...first.data.metadata, approval_status: "approved" } } });
  const ticket = await prisma.kitchenTicket.upsert({ where: { orderId: first.data.id }, create: { businessId: id, orderId: first.data.id, status: "preparing" }, update: { status: "preparing" } });
  const track = async () => (await (await fetch(`${base}/orders/${first.data.tracking_token}`)).json()).data;
  eq((await track()).tracking.status, "preparing");
  for (const [status, expected] of [["ready", "ready"], ["served", "completed"], ["rejected", "rejected"]]) {
    await prisma.kitchenTicket.update({ where: { id: ticket.id }, data: { status } });
    eq((await track()).tracking.status, expected);
  }
  eq((await fetch(`${base}/orders/nonexistent-token`)).status, 404);
  await prisma.tableSession.update({ where: { id: visit.id }, data: { status: "closed", closedAt: new Date() } });
  eq((await send("closed")).status, 409);
  await qrOrderingService.getMenu({ token: qr.token });
  eq((await send("old-visit")).status, 409);
  eq(guestProgress({ status: "cancelled", metadata: {} }, "ready"), "cancelled");
  eq(guestProgress({ status: "qr_pending_approval", metadata: { approval_status: "pending" } }, null), "pending");
  console.log(`QR progress passed: ${checks} checks (rounds, retries, kitchen/payment separation, terminal statuses, expired visits).`);
} finally {
  env.admincore.enabled = previous;
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await prisma.business.deleteMany({ where: { id } });
  await prisma.stateDocument.deleteMany({ where: { OR: [{ key: { contains: id } }, { data: { path: ["business_id"], equals: id } }] } });
  await stopRealtime(); await prisma.$disconnect();
}
