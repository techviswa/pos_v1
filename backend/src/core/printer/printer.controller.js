import { apiResponse } from "../../shared/utils/apiResponse.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { printerService } from "../../services/printer/printer.service.js";

class PrinterController {
  async list(req, res) {
    const data = await printerService.listPrintJobs({ businessId: req.context.businessId, status: req.query?.status });
    res.status(200).json(apiResponse({ message: "Print jobs fetched successfully", data }));
  }

  async create(req, res) {
    const data = await printerService.queuePrintJob({
      businessId: req.context.businessId,
      type: req.body?.type,
      target: req.body?.target,
      payload: req.body?.payload,
      copies: req.body?.copies,
      autoPrint: req.body?.auto_print ?? req.body?.autoPrint,
    });
    res.status(202).json(apiResponse({ message: "Print job queued successfully", data }));
  }

  async getById(req, res) {
    const data = await printerService.getPrintJob(req.params.jobId, req.context.businessId);
    if (!data) {
      throw createHttpError({ statusCode: 404, message: "Print job not found" });
    }
    res.status(200).json(apiResponse({ message: "Print job fetched successfully", data }));
  }

  async complete(req, res) {
    const data = await printerService.completePrintJob(req.params.jobId, req.context.businessId, req.printerAgentId);
    if (!data) {
      throw createHttpError({ statusCode: 404, message: "Print job not found" });
    }
    res.status(200).json(apiResponse({ message: "Print job completed successfully", data }));
  }

  async fail(req, res) {
    const data = await printerService.failPrintJob(req.params.jobId, req.body?.error, req.context.businessId, req.printerAgentId);
    if (!data) {
      throw createHttpError({ statusCode: 404, message: "Print job not found" });
    }
    res.status(200).json(apiResponse({ message: "Print job marked failed successfully", data }));
  }

  async agentHeartbeat(req, res) {
    const data = await printerService.recordAgentHeartbeat({
      businessId: req.context.businessId,
      agentId: req.printerAgentId,
      payload: req.body || {},
    });
    res.status(200).json(apiResponse({ message: "Printer agent heartbeat recorded successfully", data }));
  }

  async listAgents(req, res) {
    const data = await printerService.listAgents(req.context.businessId);
    res.status(200).json(apiResponse({ message: "Printer agents fetched successfully", data }));
  }

  async claimNext(req, res) {
    const data = await printerService.claimNextPrintJob({
      businessId: req.context.businessId,
      agentId: req.printerAgentId,
      target: req.body?.target || req.query?.target,
    });
    if (!data) {
      res.status(204).send();
      return;
    }
    res.status(200).json(apiResponse({ message: "Print job claimed successfully", data }));
  }
}

export const printerController = new PrinterController();
