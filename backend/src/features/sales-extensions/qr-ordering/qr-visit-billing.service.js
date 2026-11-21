import { randomUUID, createHash } from "node:crypto";
import prisma from "../../../database/prisma/client.js";
import { billingService } from "../../../core/billing/billing.service.js";
import { lockSettlement } from "../../../core/billing/settlement.service.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import { publishChange } from "../../../services/realtime/realtime.service.js";

const fail = (code, message) => { throw createHttpError({ statusCode: code, message }); };
const cents = (value) => Math.round(Number(value || 0) * 100);
// Largest remainder allocation: every paise is assigned exactly once.
export function allocateMoney(amount, weights) {
  const total = cents(amount), sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map((_, i) => i === 0 ? total / 100 : 0);
  const raw = weights.map((weight) => total * weight / sum), parts = raw.map(Math.floor);
  const ranked = raw.map((value, i) => ({ i, fraction: value - parts[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  const remainder = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) parts[ranked[i].i]++;
  return parts.map((part) => part / 100);
}

async function visit(client, businessId, orderId, outletScope) {
  const anchor = await client.order.findFirst({ where: { id: orderId, businessId, channel: "qr" } });
  if (!anchor) fail(404, "QR order not found");
  if (outletScope && !outletScope.includes(anchor.outletId)) fail(403, "This outlet is not assigned to you");
  const session = await client.tableSession.findFirst({ where: { id: anchor.metadata?.table_session_id || "", businessId } });
  if (!session || session.status === "closed" || new Date(anchor.createdAt) < new Date(session.openedAt)) fail(409, "This table visit has closed or changed. Use individual bill requests for historical orders.");
  const orders = await client.order.findMany({ where: { businessId, channel: "qr", outletId: anchor.outletId,
    createdAt: { gte: session.openedAt }, metadata: { path: ["table_session_id"], equals: session.id },
  }, include: { items: true, bill: true }, orderBy: { createdAt: "asc" } });
  return { anchor, session, orders };
}

export const qrVisitBillingService = {
  async preview({ businessId, orderId, outletScope }) {
    const data = await visit(prisma, businessId, orderId, outletScope);
    return { session_id: data.session.id, orders: data.orders.filter((order) => !order.bill && !order.metadata?.qr_bill_ids?.length && order.metadata?.approval_status === "approved" && !["cancelled", "rejected", "qr_rejected"].includes(order.status))
      .map((order) => ({ id: order.id, customer_name: order.customerName, created_at: order.createdAt,
        service_charge: order.metadata?.service_charge || 0, tip: order.metadata?.tip_amount || 0,
        points_requested: order.metadata?.qr_loyalty_points || 0,
        items: order.items.map((item) => ({ id: item.id, name: item.name, variation: item.variation, quantity: item.quantity, price: Number(item.price) })) })) };
  },
  async issue({ businessId, tenantId, orderId, outletScope, user, payload = {} }) {
    const ids = payload.order_ids, groups = payload.groups;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string")) fail(400, "Select between 1 and 50 distinct orders");
    if (!Array.isArray(groups) || !groups.length || groups.length > 20) fail(400, "Create between 1 and 20 invoices");
    if (typeof payload.client_request_id !== "string" || !/^[\w-]{8,80}$/.test(payload.client_request_id)) fail(400, "A billing request key is required");
    const digest = createHash("sha256").update(JSON.stringify({ ids, groups })).digest("hex");
    const key = `qr-billing:${businessId}:${payload.client_request_id}`;
    return prisma.$transaction(async (tx) => {
      await lockSettlement(tx, businessId);
      const prior = await tx.stateDocument.findUnique({ where: { key } });
      if (prior) {
        if (prior.data.digest !== digest) fail(409, "This billing request key was already used for a different allocation");
        // Retry authorisation is checked even after a seating closes.
        if (outletScope && !outletScope.includes(prior.data.outlet_id)) fail(403, "This outlet is not assigned to you");
        return { bill_ids: prior.data.bill_ids, replayed: true };
      }
      for (const id of [...ids].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qr-invoice:${id}`}))`;
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
      }
      const data = await visit(tx, businessId, orderId, outletScope);
      const orders = ids.map((id) => data.orders.find((order) => order.id === id));
      if (orders.some((order) => !order)) fail(400, "Only orders from this outlet and table visit can be combined");
      if (orders.some((order) => order.bill || order.metadata?.qr_bill_ids?.length || order.metadata?.approval_status !== "approved" || ["cancelled", "rejected", "qr_rejected"].includes(order.status))) fail(409, "An order is already billed or is not accepted. Refresh the allocation.");
      // Do not silently transfer one guest's verified redemption to another invoice/customer.
      if (orders.some((order) => Number(order.metadata?.qr_loyalty_points || 0) > 0)) fail(409, "Clear the loyalty redemption request before combining or splitting. Staff can issue its original invoice with the verified redemption instead.");
      const lines = new Map(orders.flatMap((order) => order.items.map((item) => [item.id, { ...item, sourceOrder: order }])));
      const used = new Map();
      const allocations = groups.map((group) => {
        if (!Array.isArray(group?.items) || !group.items.length || group.items.length > 500) fail(400, "Every invoice needs ordered items");
        const seen = new Set();
        return group.items.map((selection) => {
          if (!selection || typeof selection !== "object") fail(400, "Select valid ordered items");
          const line = lines.get(selection.item_id), quantity = selection.quantity;
          if (!line || !Number.isSafeInteger(quantity) || quantity <= 0 || seen.has(line.id)) fail(400, "Select valid ordered quantities once per invoice");
          seen.add(line.id); used.set(line.id, (used.get(line.id) || 0) + quantity);
          return { ...line, quantity };
        });
      });
      if ([...lines.values()].some((line) => used.get(line.id) !== line.quantity)) fail(400, "Assign every ordered quantity exactly once across the invoices");
      const charges = allocations.map(() => ({ serviceCharge: 0, tip: 0 }));
      for (const order of orders) {
        const weights = allocations.map((items) => items.filter((item) => item.orderId === order.id).reduce((sum, item) => sum + item.quantity * (cents(item.price) || 1), 0));
        for (const [field, metadata] of [["serviceCharge", "service_charge"], ["tip", "tip_amount"]]) {
          allocateMoney(order.metadata?.[metadata], weights).forEach((amount, i) => { charges[i][field] = (cents(charges[i][field]) + cents(amount)) / 100; });
        }
      }
      const batchId = randomUUID(), bills = [];
      for (let i = 0; i < allocations.length; i++) {
        const items = allocations[i], sourceIds = [...new Set(items.map((item) => item.orderId))];
        const samePhone = new Set(items.map((item) => item.sourceOrder.metadata?.customer_phone || "")).size === 1;
        const bill = await billingService.createInvoice({ tenantId, user, transaction: tx,
          payload: { customer_name: samePhone ? items[0].sourceOrder.customerName : "Table guests", customer_phone: samePhone ? items[0].sourceOrder.metadata?.customer_phone : null,
            outlet_id: data.anchor.outletId, order_type: "Dine-In", table_label: data.anchor.metadata?.table_name,
            payment_type: "Due", payments: [], loyalty_redeem_points: 0, client_request_id: `qr-batch:${batchId}:${i}` },
          qrAllocation: { items, ...charges[i], orderIds: sourceIds, batchId, lines: items.map((item) => ({ order_id: item.orderId, item_id: item.id, quantity: item.quantity })) },
        });
        bills.push(bill.id);
      }
      for (const order of orders) {
        const billIds = bills.filter((_, index) => allocations[index].some((item) => item.orderId === order.id));
        await tx.order.update({ where: { id: order.id }, data: { status: "billed", metadata: { ...order.metadata, qr_bill_ids: billIds, qr_billing_batch: batchId, bill_requested: false } } });
      }
      await tx.stateDocument.create({ data: { key, data: { business_id: businessId, outlet_id: data.anchor.outletId, digest, bill_ids: bills } } });
      await publishChange({ businessId, resource: "qr_orders", action: "visit_billed", recordId: orderId, outletId: data.anchor.outletId }, { tx });
      return { bill_ids: bills, replayed: false };
    }, { timeout: 60000 });
  },
};
