import prisma from "../src/database/prisma/client.js";
import { normalizePhone } from "../src/core/customers/customer-core.js";
try {
  for (const business of await prisma.business.findMany({ select: { id: true } })) {
    const bills = await prisma.bill.findMany({ where: { businessId: business.id }, select: { metadata: true, status: true } });
    const tickets = await prisma.kitchenTicket.findMany({ where: { businessId: business.id }, include: { order: { select: { status: true, metadata: true, _count: { select: { items: true } }, bill: { select: { status: true } } } } } });
    console.log(JSON.stringify({ business: business.id, customers: await prisma.customer.count({ where: { businessId: business.id } }), bills: bills.length,
      profileNames: (await prisma.customer.findMany({ where: { businessId: business.id }, select: { name: true } })).map((row) => row.name),
      qrGuests: (await prisma.order.findMany({ where: { businessId: business.id, channel: "qr" }, select: { customerName: true, metadata: true } })).map((order) => ({ name: order.customerName, hasPhone: Boolean(order.metadata?.customer_phone), validPhone: Boolean(normalizePhone(order.metadata?.customer_phone)), phoneKeys: Object.keys(order.metadata || {}).filter((key) => /phone|customer/i.test(key)) })),
      billsWithPhone: bills.filter((bill) => bill.metadata?.customer_phone).length, linkedBills: bills.filter((bill) => bill.metadata?.customer_id).length,
      tickets: tickets.map((ticket) => ({ id: ticket.id, status: ticket.status, order: ticket.order.status, bill: ticket.order.bill?.status, savedItems: ticket.order.metadata?.kot?.items?.length, orderItems: ticket.order._count.items })) }));
  }
} finally { await prisma.$disconnect(); }
