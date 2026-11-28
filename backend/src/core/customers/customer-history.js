import prisma from "../../database/prisma/client.js";
import { normalizePhone, upsertCustomerForBill, reconcileBillCustomer } from "./customer-core.js";

// Upgrade existing records into profiles without inventing retroactive rewards.
// Row locks and the saved customer_id make retries and concurrent readers safe.
const running = new Map();
export const synchronizeCustomerHistory = (businessId) => {
  if (!businessId) throw new Error("Customer history requires a business");
  if (running.has(businessId)) return running.get(businessId);
  const work = (async () => {
    // The full sweep runs once per business; later runs only look at records created since the last sweep
    // (new bills and orders are linked to guests when they are made). Every customer search calls this.
    const stateKey = `customer-history:${businessId}`;
    const state = (await prisma.stateDocument.findUnique({ where: { key: stateKey } }))?.data;
    const startedAt = new Date();
    const since = state?.synced_at ? { createdAt: { gte: new Date(Date.parse(state.synced_at) - 10 * 60 * 1000) } } : {};
    let cursor;
    do {
      const bills = await prisma.bill.findMany({ where: { businessId, ...since }, orderBy: { id: "asc" }, take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, metadata: true } });
      for (const candidate of bills) {
        if (candidate.metadata?.customer_id || !normalizePhone(candidate.metadata?.customer_phone)) continue;
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Bill" WHERE id=${candidate.id} AND "businessId"=${businessId} FOR UPDATE`;
          const bill = await tx.bill.findFirst({ where: { id: candidate.id, businessId } });
          if (!bill || bill.metadata?.customer_id) return;
          const customer = await upsertCustomerForBill(tx, { businessId, phone: bill.metadata?.customer_phone, name: bill.customerName });
          if (!customer) return;
          const metadata = { ...bill.metadata, customer_id: customer.id, customer_stats: { visit: 0, spent: 0 }, loyalty_exempt: true };
          const stats = await reconcileBillCustomer(tx, { bill: { ...bill, metadata } });
          await tx.bill.update({ where: { id: bill.id }, data: { metadata: { ...metadata, ...stats } } });
        });
      }
      cursor = bills.length === 200 ? bills.at(-1).id : null;
    } while (cursor);
    let orderCursor;
    do {
    const orders = await prisma.order.findMany({ where: { businessId, bill: { is: null }, ...since }, orderBy: { id: "asc" }, take: 500, ...(orderCursor ? { cursor: { id: orderCursor }, skip: 1 } : {}), select: { id: true, metadata: true } });
    orderCursor = orders.length === 500 ? orders.at(-1).id : null;
    for (const order of orders) if (normalizePhone(order.metadata?.customer_phone)) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${order.id} AND "businessId"=${businessId} FOR UPDATE`;
        const fresh = await tx.order.findFirst({ where: { id: order.id, businessId } });
        if (fresh) await upsertCustomerForBill(tx, { businessId, phone: fresh.metadata?.customer_phone, name: fresh.customerName });
      });
    }
    } while (orderCursor);
    const data = { business_id: businessId, synced_at: startedAt.toISOString() };
    await prisma.stateDocument.upsert({ where: { key: stateKey }, create: { key: stateKey, data }, update: { data } });
  })();
  running.set(businessId, work);
  return work.finally(() => { if (running.get(businessId) === work) running.delete(businessId); });
};
