import prisma from "../../../database/prisma/client.js";
import { admincoreChangeSyncService } from "../../../core/admincore/admincore-change-sync.service.js";
import { aggregateKitchenStatus, validateKitchenTransition } from "./kot-workflow.js";
import { nextDocumentSequence } from "../../../database/prisma/document-sequence.js";
import { ensureBusiness } from "../../../database/prisma/helpers.js";
import { createHttpError } from "../../../shared/utils/http-error.js";
import {
  appendKotAudit,
  buildKotItemState,
  buildPrintPayload,
  createKotTicketNumber,
  getDefaultStations,
  KOT_STATUSES,
  nowIso,
  summarizeKotTiming,
} from "./kot.utils.js";

const getTicketInclude = () => ({
  business: true,
  order: {
    include: {
      items: true,
    },
  },
});

class KotService {
  getStations() {
    return getDefaultStations();
  }

  getOrderKot(order) {
    return order?.metadata?.kot || {};
  }

  serializeTicket(ticket) {
    const order = ticket.order;
    const kot = this.getOrderKot(order);
    const timing = summarizeKotTiming(kot);

    return {
      id: ticket.id,
      ticket_id: ticket.id,
      ticket_number: kot.ticket_number || ticket.id,
      business_id: ticket.businessId,
      order_id: ticket.orderId,
      customer_name: order?.customerName || "Walk-in",
      notes: order?.metadata?.notes || order?.metadata?.customer_note || "",
      channel: order?.channel || "pos",
      table_label: order?.metadata?.table_name || order?.metadata?.table_label || null,
      token_number: order?.metadata?.token_number || kot.token_number || null,
      status: ticket.status,
      kitchen_status: ticket.status,
      items: kot.items || buildKotItemState({ orderItems: order?.items || [], stations: this.getStations() }),
      station_summary: this.buildStationSummary(kot.items || []),
      audit: kot.audit || [],
      reject_reason: kot.reject_reason || null,
      accepted_at: kot.accepted_at || null,
      prep_started_at: kot.prep_started_at || null,
      ready_at: kot.ready_at || null,
      served_at: kot.served_at || null,
      completed_at: kot.completed_at || null,
      ...timing,
      created_at: ticket.createdAt ? ticket.createdAt.toISOString() : null,
      updated_at: ticket.updatedAt ? ticket.updatedAt.toISOString() : null,
      print_payload: buildPrintPayload({ ticket, order, kot }),
    };
  }

  buildStationSummary(items = []) {
    return Object.values(
      (items || []).reduce((summary, item) => {
        const key = item.station_id || "main_kitchen";
        summary[key] = summary[key] || {
          station_id: key,
          station_name: item.station_name || "Main Kitchen",
          pending: 0,
          accepted: 0,
          preparing: 0,
          ready: 0,
          served: 0,
          rejected: 0,
          total: 0,
        };
        summary[key].total += 1;
        summary[key][item.status] = (summary[key][item.status] || 0) + 1;
        return summary;
      }, {}),
    );
  }

  async ensureTicketForOrder({ tx = prisma, businessId, orderId, status = KOT_STATUSES.PENDING, actor = null }) {
    if (tx === prisma) {
      return prisma.$transaction((client) => this.ensureTicketForOrder({ tx: client, businessId, orderId, status, actor }));
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kot:${businessId}:${orderId}`}))`;
    const order = await tx.order.findFirst({
      where: { id: orderId, businessId },
      include: { items: true },
    });

    if (!order) {
      throw createHttpError({ statusCode: 404, message: "Order not found for KOT" });
    }
    if (order.channel === "qr" && (order.metadata?.approval_status !== "approved" || ["qr_pending_approval", "qr_rejected"].includes(order.status))) {
      throw createHttpError({ statusCode: 409, message: "Restaurant approval is required before sending a QR order to the kitchen" });
    }

    let ticket = await tx.kitchenTicket.findFirst({
      where: { businessId, orderId },
      include: getTicketInclude(),
    });

    if (!ticket) {
      ticket = await tx.kitchenTicket.create({
        data: { businessId, orderId, status },
        include: getTicketInclude(),
      });
    }

    const freshOrder = ticket.order || order;
    const currentKot = this.getOrderKot(freshOrder);
    const items = buildKotItemState({
      orderItems: freshOrder.items || [],
      stations: this.getStations(),
      existingItems: currentKot.items || [],
    });
    const kot = appendKotAudit(
      {
        ...currentKot,
        ticket_number:
          currentKot.ticket_number ||
          createKotTicketNumber({
            createdAt: ticket.createdAt,
            sequence: await nextDocumentSequence(tx, `kot:${businessId}`, await tx.kitchenTicket.count({ where: { businessId } })),
          }),
        created_at: currentKot.created_at || ticket.createdAt.toISOString(),
        estimated_prep_minutes:
          currentKot.estimated_prep_minutes || freshOrder.metadata?.estimated_prep_minutes || 20,
        token_number: currentKot.token_number || freshOrder.metadata?.token_number || null,
        items,
        audit: currentKot.audit || [],
      },
      {
        action: "ticket_created_or_synced",
        status,
        actor_id: actor?.id || null,
        actor_name: actor?.name || null,
      },
    );

    await tx.order.update({
      where: { id: freshOrder.id },
      data: {
        metadata: {
          ...(freshOrder.metadata || {}),
          kot,
        },
      },
    });

    return tx.kitchenTicket.findUnique({
      where: { id: ticket.id },
      include: getTicketInclude(),
    });
  }

  async getTicket({ tenantId, ticketId }) {
    const business = await ensureBusiness({ tenantId });
    const ticket = await prisma.kitchenTicket.findFirst({
      where: { id: ticketId, businessId: business.id },
      include: getTicketInclude(),
    });

    if (!ticket) {
      throw createHttpError({ statusCode: 404, message: "KOT ticket not found" });
    }

    return ticket;
  }

  async listTickets({ tenantId, limit, status, stationId }) {
    const business = await ensureBusiness({ tenantId });
    const parsedLimit = Number(limit);
    const tickets = await prisma.kitchenTicket.findMany({
      where: {
        businessId: business.id,
        ...(status ? { status } : {}),
      },
      include: getTicketInclude(),
      orderBy: { createdAt: "desc" },
      ...(Number.isInteger(parsedLimit) && parsedLimit > 0 ? { take: parsedLimit } : {}),
    });

    const items = tickets
      .map((ticket) => this.serializeTicket(ticket))
      .filter((ticket) =>
        stationId ? (ticket.items || []).some((item) => item.station_id === stationId) : true,
      );

    return {
      tenantId,
      stations: this.getStations(),
      summary: this.buildQueueSummary(items),
      items,
    };
  }

  buildQueueSummary(tickets = []) {
    return tickets.reduce(
      (summary, ticket) => {
        summary.total += 1;
        summary[ticket.status] = (summary[ticket.status] || 0) + 1;
        if (ticket.sla_status === "breached") summary.sla_breached += 1;
        return summary;
      },
      {
        total: 0,
        pending: 0,
        accepted: 0,
        preparing: 0,
        ready: 0,
        served: 0,
        completed: 0,
        rejected: 0,
        sla_breached: 0,
      },
    );
  }

  async createTicket({ tenantId, payload, actor }) {
    if (payload.status && payload.status !== KOT_STATUSES.PENDING) throw createHttpError({ statusCode: 400, message: "New kitchen tickets must start pending" });
    const business = await ensureBusiness({ tenantId });
    const ticket = await this.ensureTicketForOrder({
      businessId: business.id,
      orderId: payload.orderId || payload.order_id,
      status: payload.status || KOT_STATUSES.PENDING,
      actor,
    });
    return this.serializeTicket(ticket);
  }

  async mutateTicket({ tenantId, ticketId, actor, updater }) {
    const scopedTicket = await this.getTicket({ tenantId, ticketId });
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kot:${scopedTicket.businessId}:${scopedTicket.orderId}`}))`;
      const ticket = await tx.kitchenTicket.findFirstOrThrow({
        where: { id: ticketId, businessId: scopedTicket.businessId }, include: getTicketInclude(),
      });
      const order = ticket.order;
      const currentKot = this.getOrderKot(order);
      const next = updater({ ticket, order, kot: currentKot });
      const nextStatus = next.status || ticket.status;
      if (next.action !== "item_status_updated") validateKitchenTransition(ticket.status, nextStatus);
      if (nextStatus === ticket.status && ["completed", "rejected"].includes(nextStatus)) return this.serializeTicket(ticket);
      const nextKot = appendKotAudit(
        { ...currentKot, ...next.kot },
        { action: next.action || "ticket_updated", status: nextStatus,
          actor_id: actor?.id || null, actor_name: actor?.name || null, reason: next.reason || null },
      );
      await tx.kitchenTicket.update({ where: { id: ticket.id }, data: { status: nextStatus } });
      await tx.order.update({
        where: { id: order.id },
        data: { status: next.orderStatus || order.status, metadata: { ...(order.metadata || {}), kot: nextKot } },
      });
      await admincoreChangeSyncService.notifyChange({
        resource: "orders", action: "updated", recordId: order.id,
        tenantId, businessId: ticket.businessId, outletId: order.metadata?.outlet_id || null,
        metadata: { kitchen_ticket_id: ticket.id, kitchen_status: nextStatus },
      }, { tx });
      return this.serializeTicket(await tx.kitchenTicket.findUniqueOrThrow({
        where: { id: ticket.id }, include: getTicketInclude(),
      }));
    });
  }

  async updateTicketStatus({ tenantId, ticketId, kitchenStatus, actor }) {
    const actions = { accepted: "acceptTicket", preparing: "startPrep", ready: "markReady" };
    const action = actions[kitchenStatus];
    if (!action) throw createHttpError({ statusCode: 400, message: "Use accept, prepare, ready, rejection, or service completion actions" });
    return this[action]({ tenantId, ticketId, actor });
  }

  async acceptTicket({ tenantId, ticketId, actor }) {
    return this.mutateTicket({
      tenantId,
      ticketId,
      actor,
      updater: ({ kot }) => {
        const at = nowIso();
        return {
          status: KOT_STATUSES.ACCEPTED,
          orderStatus: "accepted",
          action: "ticket_accepted",
          kot: {
            ...kot,
            accepted_at: kot.accepted_at || at,
            items: (kot.items || []).map((item) => ({
              ...item,
              status: item.status === KOT_STATUSES.PENDING ? KOT_STATUSES.ACCEPTED : item.status,
              accepted_at: item.accepted_at || at,
            })),
          },
        };
      },
    });
  }

  async rejectTicket({ tenantId, ticketId, reason, actor }) {
    if (typeof reason !== "string" || !reason.trim()) throw createHttpError({ statusCode: 400, message: "Rejection reason is required" });
    return this.mutateTicket({
      tenantId,
      ticketId,
      actor,
      updater: ({ kot }) => {
        const at = nowIso();
        return {
          status: KOT_STATUSES.REJECTED,
          orderStatus: "rejected",
          action: "ticket_rejected",
          reason,
          kot: {
            ...kot,
            rejected_at: at,
            reject_reason: reason || "",
            items: (kot.items || []).map((item) => ({
              ...item,
              status: KOT_STATUSES.REJECTED,
              rejected_at: item.rejected_at || at,
              reject_reason: reason || "",
            })),
          },
        };
      },
    });
  }

  async startPrep({ tenantId, ticketId, actor }) {
    return this.mutateTicket({
      tenantId,
      ticketId,
      actor,
      updater: ({ kot }) => {
        const at = nowIso();
        return {
          status: KOT_STATUSES.PREPARING,
          orderStatus: "preparing",
          action: "prep_started",
          kot: {
            ...kot,
            prep_started_at: kot.prep_started_at || at,
            items: (kot.items || []).map((item) => ({
              ...item,
              status: [KOT_STATUSES.PENDING, KOT_STATUSES.ACCEPTED].includes(item.status)
                ? KOT_STATUSES.PREPARING
                : item.status,
              prep_started_at: item.prep_started_at || at,
            })),
          },
        };
      },
    });
  }

  async markReady({ tenantId, ticketId, actor }) {
    return this.mutateTicket({
      tenantId,
      ticketId,
      actor,
      updater: ({ kot }) => {
        if ((kot.items || []).some((item) => ["pending", "accepted"].includes(item.status))) throw createHttpError({ statusCode: 409, message: "Start preparation for every active item before marking the ticket ready" });
        const at = nowIso();
        return {
          status: KOT_STATUSES.READY,
          orderStatus: "ready",
          action: "ticket_ready_for_waiter",
          kot: {
            ...kot,
            ready_at: kot.ready_at || at,
            items: (kot.items || []).map((item) => ({
              ...item,
              status: ![KOT_STATUSES.REJECTED, KOT_STATUSES.SERVED].includes(item.status) ? KOT_STATUSES.READY : item.status,
              ready_at: item.ready_at || at,
            })),
          },
        };
      },
    });
  }

  async completeService({ tenantId, ticketId, actor }) {
    return this.mutateTicket({
      tenantId,
      ticketId,
      actor,
      updater: ({ kot }) => {
        const at = nowIso();
        return {
          status: KOT_STATUSES.COMPLETED,
          orderStatus: "served",
          action: "service_completed",
          kot: {
            ...kot,
            served_at: kot.served_at || at,
            completed_at: at,
            items: (kot.items || []).map((item) => ({
              ...item,
              status: item.status !== KOT_STATUSES.REJECTED ? KOT_STATUSES.SERVED : item.status,
              served_at: item.served_at || at,
            })),
          },
        };
      },
    });
  }

  async updateItemStatus({ tenantId, ticketId, itemId, status, reason, actor }) {
    const allowedRoles = status === KOT_STATUSES.SERVED ? ["Owner", "Manager", "Waiter"] : ["Owner", "Manager", "Chef"];
    if (!allowedRoles.includes(actor?.role)) throw createHttpError({ statusCode: 403, message: "Your role cannot perform this kitchen action" });
    return this.mutateTicket({
      tenantId,
      ticketId,
      actor,
      updater: ({ ticket, kot }) => {
        const currentItem = (kot.items || []).find((item) => item.item_id === itemId);
        if (!currentItem) throw createHttpError({ statusCode: 404, message: "Kitchen item not found" });
        if (["completed", "rejected"].includes(ticket.status)) throw createHttpError({ statusCode: 409, message: "Closed kitchen tickets cannot be changed" });
        validateKitchenTransition(currentItem.status, status, { item: true });
        if (status === "rejected" && (typeof reason !== "string" || !reason.trim())) throw createHttpError({ statusCode: 400, message: "Rejection reason is required" });
        const at = nowIso();
        const items = (kot.items || []).map((item) => {
          if (item.item_id !== itemId) return item;
          return {
            ...item,
            status,
            ...(status === KOT_STATUSES.ACCEPTED ? { accepted_at: item.accepted_at || at } : {}),
            ...(status === KOT_STATUSES.PREPARING ? { prep_started_at: item.prep_started_at || at } : {}),
            ...(status === KOT_STATUSES.READY ? { ready_at: item.ready_at || at } : {}),
            ...(status === KOT_STATUSES.SERVED ? { served_at: item.served_at || at } : {}),
            ...(status === KOT_STATUSES.REJECTED
              ? { rejected_at: item.rejected_at || at, reject_reason: reason || "" }
              : {}),
          };
        });
        const aggregateStatus = aggregateKitchenStatus(items);

        return {
          status: aggregateStatus,
          action: "item_status_updated",
          reason,
          orderStatus: aggregateStatus === KOT_STATUSES.COMPLETED ? "served" : aggregateStatus,
          kot: {
            ...kot,
            items,
            ...(aggregateStatus === "accepted" ? { accepted_at: kot.accepted_at || at } : {}),
            ...(aggregateStatus === "preparing" ? { prep_started_at: kot.prep_started_at || at } : {}),
            ...(aggregateStatus === "ready" ? { ready_at: kot.ready_at || at } : {}),
            ...(aggregateStatus === "completed" ? { served_at: kot.served_at || at, completed_at: kot.completed_at || at } : {}),
          },
        };
      },
    });
  }

  async getHistory({ tenantId, ticketId }) {
    const ticket = await this.getTicket({ tenantId, ticketId });
    return {
      ticket_id: ticket.id,
      ticket_number: this.getOrderKot(ticket.order).ticket_number || ticket.id,
      audit: this.getOrderKot(ticket.order).audit || [],
    };
  }

  async getPrintPayload({ tenantId, ticketId }) {
    const ticket = await this.getTicket({ tenantId, ticketId });
    return buildPrintPayload({
      ticket,
      order: ticket.order,
      kot: this.getOrderKot(ticket.order),
    });
  }
}

export const kotService = new KotService();
