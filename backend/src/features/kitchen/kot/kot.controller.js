import { apiResponse } from "../../../shared/utils/apiResponse.js";
import { kotService } from "./kot.service.js";

class KotController {
  async list(req, res) {
    const data = await kotService.listTickets({
      tenantId: req.context.tenantId,
      limit: req.query?.limit,
      status: req.query?.status,
      stationId: req.query?.station_id || req.query?.stationId,
    });
    res.status(200).json(apiResponse({ message: "KOT tickets fetched successfully", data }));
  }

  async stations(_req, res) {
    const data = kotService.getStations();
    res.status(200).json(apiResponse({ message: "Kitchen stations fetched successfully", data }));
  }

  async create(req, res) {
    const data = await kotService.createTicket({
      tenantId: req.context.tenantId,
      payload: req.body,
      actor: req.user,
    });
    res.status(201).json(apiResponse({ message: "KOT ticket created successfully", data }));
  }

  async updateStatus(req, res) {
    const data = await kotService.updateTicketStatus({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
      kitchenStatus: req.body.kitchen_status || req.body.kitchenStatus || null,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "KOT ticket updated successfully", data }));
  }

  async accept(req, res) {
    const data = await kotService.acceptTicket({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "KOT ticket accepted successfully", data }));
  }

  async reject(req, res) {
    const data = await kotService.rejectTicket({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
      reason: req.body?.reason,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "KOT ticket rejected successfully", data }));
  }

  async startPrep(req, res) {
    const data = await kotService.startPrep({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "KOT prep started successfully", data }));
  }

  async ready(req, res) {
    const data = await kotService.markReady({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "KOT ticket marked ready successfully", data }));
  }

  async completeService(req, res) {
    const data = await kotService.completeService({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "KOT service completed successfully", data }));
  }

  async updateItemStatus(req, res) {
    const data = await kotService.updateItemStatus({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
      itemId: req.params.itemId,
      status: req.body?.status || req.body?.kitchen_status,
      reason: req.body?.reason,
      actor: req.user,
    });
    res.status(200).json(apiResponse({ message: "KOT item updated successfully", data }));
  }

  async history(req, res) {
    const data = await kotService.getHistory({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
    });
    res.status(200).json(apiResponse({ message: "KOT history fetched successfully", data }));
  }

  async print(req, res) {
    const data = await kotService.getPrintPayload({
      tenantId: req.context.tenantId,
      ticketId: req.params.ticketId,
    });
    res.status(200).json(apiResponse({ message: "KOT print payload fetched successfully", data }));
  }
}

export const kotController = new KotController();
