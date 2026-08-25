import { apiResponse } from "../../shared/utils/apiResponse.js";
import { feedbackService } from "./feedback.service.js";

class FeedbackController {
  async list(_req, res) {
    const data = await feedbackService.listFeedback();
    res.status(200).json(apiResponse({ message: "Feedback fetched successfully", data }));
  }

  async form(req, res) {
    const data = await feedbackService.getFeedbackForm({ token: req.params.token });
    res.status(200).json(apiResponse({ message: "Feedback form fetched successfully", data }));
  }

  async submit(req, res) {
    const data = await feedbackService.submitFeedbackForm({
      token: req.params.token,
      payload: req.body,
    });
    res.status(201).json(apiResponse({ message: "Feedback submitted successfully", data }));
  }
}

export const feedbackController = new FeedbackController();
