import prisma from "../../database/prisma/client.js";
import {
  ensureBusiness,
  serializeOrder,
  toPrismaOrderItems,
} from "../../database/prisma/helpers.js";
import { orderFulfillmentService } from "../../services/workflows/order-fulfillment.service.js";
import { DEFAULT_CUSTOMER_NAME, DEFAULT_ORDER_CHANNEL } from "../../shared/constants/domain.constants.js";
import { getPagination } from "../../shared/utils/pagination.js";
import { admincoreChangeSyncService } from "../admincore/admincore-change-sync.service.js";

const getOrderInclude = () => ({
  business: true,
  items: true,
});

class OrdersService {
  async listOrders({ tenantId, query = {} }) {
    const business = await ensureBusiness({ tenantId });
    const pagination = getPagination(query);
    const orders = await prisma.order.findMany({
      where: { businessId: business.id },
      include: getOrderInclude(),
      orderBy: { createdAt: "desc" },
      take: pagination.take,
      skip: pagination.skip,
    });

    return orders.map(serializeOrder);
  }

  async getOrderById({ tenantId, orderId }) {
    const business = await ensureBusiness({ tenantId });
    const order = await prisma.order.findFirstOrThrow({
      where: {
        id: orderId,
        businessId: business.id,
      },
      include: getOrderInclude(),
    });

    return serializeOrder(order);
  }

  async createOrder({ tenantId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const createdOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          businessId: business.id,
          outletId: payload.outlet_id || payload.outletId || null,
          customerName: payload.customerName || DEFAULT_CUSTOMER_NAME,
          channel: payload.channel || DEFAULT_ORDER_CHANNEL,
          total: Number(payload.total || 0),
          status: payload.status || "open",
          metadata: payload.metadata || {},
          items: {
            create: toPrismaOrderItems(payload.items || []),
          },
        },
        include: getOrderInclude(),
      });

      await orderFulfillmentService.handleOrderCreated({
        tenantId,
        businessId: business.id,
        orderId: order.id,
        tx,
      });

      return order;
    });

    const serializedOrder = serializeOrder(createdOrder);
    await admincoreChangeSyncService.notifyChange({
      resource: "orders",
      action: "created",
      recordId: serializedOrder.id,
      tenantId,
      businessId: business.id,
      outletId: serializedOrder.outlet_id,
      metadata: {
        total: serializedOrder.total,
        status: serializedOrder.status,
        channel: serializedOrder.channel,
      },
    });

    return serializedOrder;
  }

  async updateOrder({ tenantId, orderId, payload }) {
    const business = await ensureBusiness({ tenantId });
    const currentOrder = await prisma.order.findFirstOrThrow({
      where: {
        id: orderId,
        businessId: business.id,
      },
      include: getOrderInclude(),
    });

    await prisma.order.update({
      where: { id: orderId },
      data: {
        outletId: payload.outlet_id ?? payload.outletId ?? currentOrder.outletId,
        customerName: payload.customerName ?? currentOrder.customerName,
        channel: payload.channel ?? currentOrder.channel,
        total: payload.total !== undefined ? Number(payload.total) : currentOrder.total,
        status: payload.status ?? currentOrder.status,
        metadata: payload.metadata ?? currentOrder.metadata,
      },
    });

    if (payload.items !== undefined) {
      await prisma.orderItem.deleteMany({
        where: { orderId },
      });

      if ((payload.items || []).length) {
        await prisma.orderItem.createMany({
          data: toPrismaOrderItems(payload.items).map((item) => ({
            ...item,
            orderId,
          })),
        });
      }
    }

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: getOrderInclude(),
    });

    const serializedOrder = serializeOrder(order);
    await admincoreChangeSyncService.notifyChange({
      resource: "orders",
      action: "updated",
      recordId: serializedOrder.id,
      tenantId,
      businessId: business.id,
      outletId: serializedOrder.outlet_id,
      metadata: {
        total: serializedOrder.total,
        status: serializedOrder.status,
        channel: serializedOrder.channel,
      },
    });

    return serializedOrder;
  }

  async deleteOrder({ tenantId, orderId }) {
    const business = await ensureBusiness({ tenantId });
    const order = await prisma.order.findFirstOrThrow({
      where: {
        id: orderId,
        businessId: business.id,
      },
      include: getOrderInclude(),
    });

    await prisma.order.delete({
      where: { id: orderId },
    });

    const serializedOrder = serializeOrder(order);
    await admincoreChangeSyncService.notifyChange({
      resource: "orders",
      action: "deleted",
      recordId: serializedOrder.id,
      tenantId,
      businessId: business.id,
      outletId: serializedOrder.outlet_id,
      metadata: {
        total: serializedOrder.total,
        status: serializedOrder.status,
        channel: serializedOrder.channel,
      },
    });

    return serializedOrder;
  }
}

export const ordersService = new OrdersService();
