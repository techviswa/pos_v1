import { apiResponse } from "../../shared/utils/apiResponse.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { paymentsService } from "./payments.service.js";

class PaymentsController {
  async list(req, res) {
    const data = paymentsService.listIntents({ status: req.query?.status });
    res.status(200).json(apiResponse({ message: "Payment intents fetched successfully", data }));
  }

  async create(req, res) {
    const data = paymentsService.createIntent({ payload: req.body, user: req.user });
    res.status(201).json(apiResponse({ message: "Payment intent created successfully", data }));
  }

  async createPublic(req, res) {
    const data = paymentsService.createIntent({ payload: req.body, publicRequest: true });
    res.status(201).json(apiResponse({ message: "Public payment intent created successfully", data }));
  }

  async getById(req, res) {
    const data = paymentsService.getIntent(req.params.intentId);
    if (!data) {
      throw createHttpError({ statusCode: 404, message: "Payment intent not found" });
    }
    res.status(200).json(apiResponse({ message: "Payment intent fetched successfully", data }));
  }

  async confirm(req, res) {
    const data = paymentsService.confirmIntent({
      intentId: req.params.intentId,
      payload: req.body,
      user: req.user,
    });
    if (!data) {
      throw createHttpError({ statusCode: 404, message: "Payment intent not found" });
    }
    res.status(200).json(apiResponse({ message: "Payment intent confirmed successfully", data }));
  }

  async webhook(req, res) {
    const data = paymentsService.recordWebhook({
      provider: req.params.provider,
      payload: req.body,
    });
    res.status(202).json(apiResponse({ message: "Payment webhook accepted successfully", data }));
  }
}

export const paymentsController = new PaymentsController();
