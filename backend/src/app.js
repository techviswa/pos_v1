import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import env from "./config/env.js";
import { apiResponse } from "./shared/utils/apiResponse.js";
import { checkPrismaSchemaHealth } from "./database/prisma/schema-health.js";
import { jobQueue } from "./services/jobs/job-queue.js";
import { requestContextMiddleware } from "./shared/middleware/requestContext.middleware.js";
import { requireApiSession } from "./shared/middleware/authGuard.middleware.js";
import { notFoundMiddleware } from "./shared/middleware/notFound.middleware.js";
import { errorHandlerMiddleware } from "./shared/middleware/errorHandler.middleware.js";
import routes from "./routes/index.js";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.get("/health/database", async (_req, res, next) => {
  try {
    const data = await checkPrismaSchemaHealth();
    res.status(data.healthy ? 200 : 503).json(
      apiResponse({
        message: data.message,
        data,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/health/jobs", (_req, res) => {
  res.status(200).json(
    apiResponse({
      message: "Background job health fetched successfully",
      data: jobQueue.health(),
    }),
  );
});

app.use("/api", requireApiSession, routes);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

export default app;

