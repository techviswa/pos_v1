import { Router } from "express";

import { apiResponse } from "../shared/utils/apiResponse.js";
import { createHttpError } from "../shared/utils/http-error.js";
import { issueStreamTicket, openStream } from "../services/realtime/realtime.service.js";

const router = Router();

// The caller is already authenticated by requireApiSession; the ticket carries their business and outlet scope.
router.post("/ticket", (req, res, next) => {
  if (!req.user?.id || !req.context?.businessId) {
    next(createHttpError({ statusCode: 401, message: "Authentication required" }));
    return;
  }
  res.status(201).json(apiResponse({ message: "Stream ticket issued", data: issueStreamTicket({ user: req.user, context: req.context }) }));
});

router.get("/stream", openStream);

export default router;
