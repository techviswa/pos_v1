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
import { createHttpError } from "../../shared/utils/http-error.js";
import { assertOwnedIds } from "../../database/prisma/scope.js";
import { resolveTrustedItems } from "./order-pricing.js";
import { resolveMenuChannel } from "../menu/menu-pricing.js";

const isManagerRole = (user) => ["owner", "manager"].includes(String(user?.role || "").trim().toLowerCase());

// Staff may set these lifecycle states by hand. Preparing/ready/served belong to the kitchen (KOT) flow and
// "billed" to the billing flow; the QR channel is reserved for the public ordering flow.
const MANUAL_ORDER_STATUSES = new Set(["open", "accepted", "cancelled"]);
const TERMINAL_ORDER_STATUSES = new Set(["cancelled", "completed", "billed", "rejected"]);
const RESERVED_CHANNELS = new Set(["qr"]);
// Order metadata carries system state (KOT numbers, approval, payment). Staff can only edit descriptive fields.
const STAFF_METADATA_KEYS = ["notes", "table_id", "table_label", "table_name", "service_mode", "order_type", "customer_phone",
  "token_number", "pickup_slot", "fulfillment_label", "guests_count", "reservation_id"];

const pickStaffMetadata = (metadata) => {
  const picked = {};
  for (const key of STAFF_METADATA_KEYS) {
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, key)) picked[key] = metadata[key];
  }
  return picked;
};

const requireManualStatus = (status) => {
  if (!MANUAL_ORDER_STATUSES.has(status)) {
    throw createHttpError({
      statusCode: 400,
      code: "ORDER_STATUS_NOT_ALLOWED",
      message: `Orders can be set to ${[...MANUAL_ORDER_STATUSES].join(", ")}; other states are driven by the kitchen and billing flows`,
    });
  }
};

const requireStaffChannel = (channel) => {
  if (channel !== undefined && RESERVED_CHANNELS.has(String(channel).toLowerCase())) {
    throw createHttpError({ statusCode: 400, code: "ORDER_CHANNEL_RESERVED", message: "The QR channel is reserved for customer QR ordering" });
  }
};

const orderTotal = (items) =>
  Math.round(items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0) * 100) / 100;

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

  async createOrder({ tenantId, payload, actor }) {
    const business = await ensureBusiness({ tenantId });
    requireStaffChannel(payload.channel);
    const status = payload.status || "open";
    requireManualStatus(status);
    const outletId = payload.outlet_id || payload.outletId || null;
    await assertOwnedIds({ kind: "outlet", ids: [outletId], businessId: business.id });
    const createdOrder = await prisma.$transaction(async (tx) => {
      if (!Array.isArray(payload.items) || !payload.items.length) {
        throw createHttpError({ statusCode: 400, code: "ORDER_ITEMS_REQUIRED", message: "An order needs at least one item" });
      }
      // Prices and the total come from the catalogue, not from the request.
      const items = await resolveTrustedItems({ client: tx, businessId: business.id, items: payload.items, allowOpenPrice: isManagerRole(actor),
        outletId, channel: resolveMenuChannel({ ...(payload.metadata || {}), ...payload }) });
      const order = await tx.order.create({
        data: {
          businessId: business.id,
          outletId,
          customerName: String(payload.customerName || DEFAULT_CUSTOMER_NAME).slice(0, 120),
          channel: payload.channel || DEFAULT_ORDER_CHANNEL,
          total: orderTotal(items),
          status,
          metadata: pickStaffMetadata(payload.metadata),
          items: {
            create: toPrismaOrderItems(items),
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

  async updateOrder({ tenantId, orderId, payload, actor }) {
    const business = await ensureBusiness({ tenantId });
    requireStaffChannel(payload.channel);
    if (payload.status !== undefined) requireManualStatus(payload.status);
    const nextOutletId = payload.outlet_id ?? payload.outletId;
    await assertOwnedIds({ kind: "outlet", ids: [nextOutletId], businessId: business.id });

    // One transaction: a crash can no longer leave an order with its items deleted but not yet re-created.
    const order = await prisma.$transaction(async (tx) => {
      // Serialises with bill creation for this order, so it cannot be edited while (or after) it is being billed.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} AND "businessId" = ${business.id} FOR UPDATE`;
      const currentOrder = await tx.order.findFirstOrThrow({
        where: { id: orderId, businessId: business.id },
        include: { ...getOrderInclude(), bill: { select: { id: true } } },
      });
      if (currentOrder.bill || TERMINAL_ORDER_STATUSES.has(currentOrder.status)) {
        throw createHttpError({
          statusCode: 409,
          code: "ORDER_NOT_EDITABLE",
          message: "A billed, cancelled or completed order can no longer be changed",
        });
      }
      if (currentOrder.channel === "qr" && payload.channel !== undefined && String(payload.channel).toLowerCase() !== "qr") {
        throw createHttpError({ statusCode: 400, code: "ORDER_CHANNEL_RESERVED", message: "A QR order cannot change channel" });
      }
      if (currentOrder.status === "qr_pending_approval" && payload.status !== undefined) {
        throw createHttpError({ statusCode: 409, code: "QR_APPROVAL_REQUIRED", message: "Approve or reject the QR order through the QR inbox" });
      }

      let items;
      if (payload.items !== undefined) {
        if (!Array.isArray(payload.items) || !payload.items.length) {
          throw createHttpError({ statusCode: 400, code: "ORDER_ITEMS_REQUIRED", message: "An order needs at least one item" });
        }
        items = await resolveTrustedItems({ client: tx, businessId: business.id, items: payload.items, allowOpenPrice: isManagerRole(actor),
          outletId: nextOutletId ?? currentOrder.outletId ?? null,
          channel: resolveMenuChannel({ ...(currentOrder.metadata || {}), ...(payload.metadata || {}), ...payload }) });
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          outletId: nextOutletId ?? currentOrder.outletId,
          customerName: payload.customerName !== undefined ? String(payload.customerName).slice(0, 120) : currentOrder.customerName,
          channel: currentOrder.channel === "qr" ? "qr" : payload.channel ?? currentOrder.channel,
          // The total is derived from the items; it is never taken from the request.
          total: items ? orderTotal(items) : currentOrder.total,
          status: payload.status ?? currentOrder.status,
          metadata: payload.metadata !== undefined
            ? { ...(currentOrder.metadata || {}), ...pickStaffMetadata(payload.metadata) }
            : currentOrder.metadata,
        },
      });

      if (items) {
        await tx.orderItem.deleteMany({ where: { orderId } });
        await tx.orderItem.createMany({
          data: toPrismaOrderItems(items).map((item) => ({ ...item, orderId })),
        });
      }

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: getOrderInclude(),
      });
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
    const order = await prisma.$transaction(async (tx) => {
      // Same row lock bill creation takes, so an order cannot be deleted while it is being billed.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} AND "businessId" = ${business.id} FOR UPDATE`;
      const found = await tx.order.findFirstOrThrow({
        where: { id: orderId, businessId: business.id },
        include: { ...getOrderInclude(), bill: { select: { id: true } } },
      });
      if (found.bill) {
        // Deleting would orphan the bill and its audit trail.
        throw createHttpError({ statusCode: 409, code: "ORDER_HAS_BILL", message: "A billed order cannot be deleted" });
      }
      const started = await tx.kitchenTicket.count({ where: { orderId, status: { not: "pending" } } });
      if (started) {
        throw createHttpError({ statusCode: 409, code: "ORDER_IN_KITCHEN", message: "The kitchen has started this order; cancel it instead of deleting" });
      }
      await tx.order.delete({ where: { id: orderId } });
      return found;
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
