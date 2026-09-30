import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import env from "./config/env.js";
import { apiResponse } from "./shared/utils/apiResponse.js";
import { checkPrismaSchemaHealth } from "./database/prisma/schema-health.js";
import { jobQueue } from "./services/jobs/job-queue.js";
import { requestContextMiddleware } from "./shared/middleware/requestContext.middleware.js";
import { isAdminCoreBridgeRequest, requireApiSession } from "./shared/middleware/authGuard.middleware.js";
import {
  authSensitiveLimiter,
  loginAccountLimiter,
  loginIpLimiter,
  publicApiLimiter,
} from "./shared/middleware/rateLimit.middleware.js";
import { notFoundMiddleware } from "./shared/middleware/notFound.middleware.js";
import { errorHandlerMiddleware } from "./shared/middleware/errorHandler.middleware.js";
import routes from "./routes/index.js";

const app = express();

// Behind Render/Vercel proxies req.ip must be the client, or rate limits are meaningless.
if (env.nodeEnv === "production") app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true,
  }),
);
// WhatsApp callbacks are signed over the exact bytes received, so keep them for those routes.
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buffer) => {
    if (req.originalUrl.startsWith("/api/public/marketing/") || req.originalUrl.startsWith("/api/public/payments/")) req.rawBody = buffer;
  },
}));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(morgan("dev"));
app.use(requestContextMiddleware);

app.get("/", (_req, res) => {
  res.status(200).json(
    apiResponse({
      message: "POS SaaS Backend API",
      data: {
        app: env.appName,
        version: "1.0.0",
        endpoints: {
          health: "/health",
          api: "/api",
        },
        timestamp: new Date().toISOString(),
      },
    }),
  );
});

app.get("/health", (_req, res) => {
  res.status(200).json(
    apiResponse({
      message: "Health check passed",
      data: {
        app: env.appName,
        status: "ok",
        timestamp: new Date().toISOString(),
      },
    }),
  );
});

app.get("/health/database", async (req, res, next) => {
  try {
    const data = await checkPrismaSchemaHealth();
    // Schema details are reconnaissance material; only trusted callers get them in production.
    const detailed = env.nodeEnv !== "production" || isAdminCoreBridgeRequest(req);
    res.status(data.healthy ? 200 : 503).json(
      apiResponse({
        message: data.message,
        data: detailed ? data : { healthy: data.healthy },
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/health/jobs", async (req, res, next) => {
  try {
  if (env.nodeEnv === "production" && !isAdminCoreBridgeRequest(req)) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  res.status(200).json(
    apiResponse({
      message: "Background job health fetched successfully",
      data: await jobQueue.health(),
    }),
  );
  } catch (error) { next(error); }
});

app.get("/health/ready", async (_req, res) => {
  try {
    const health = await checkPrismaSchemaHealth();
    res.status(health.healthy ? 200 : 503).json({ ready: health.healthy });
  } catch {
    res.status(503).json({ ready: false });
  }
});

// Abuse controls run before authentication so they also cover the public surface.
app.post("/api/auth/login", loginIpLimiter, loginAccountLimiter);
app.post(
  ["/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/change-password", "/api/auth/invites/:token/accept"],
  authSensitiveLimiter,
);
app.use(["/api/public", "/api/feedback/form", "/api/payments/public", "/api/printer/agent", "/api/events/stream"], publicApiLimiter);

app.use("/api", requireApiSession, routes);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

export default app;

