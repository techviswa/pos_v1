import app from "./app.js";
import env, { getProductionConfigIssues } from "./config/env.js";
import { connectDatabase } from "./config/db.js";
import prisma from "./database/prisma/client.js";
import { jobQueue } from "./services/jobs/job-queue.js";
import { startMarketingWorker, stopMarketingWorker } from "./core/marketing/dispatcher.js";
import { errorMonitor, flushErrorReporting, initErrorReporting } from "./shared/utils/error-monitor.js";
import { logger } from "./shared/utils/logger.js";

let server = null;
let shuttingDown = false;
let dbConnectPromise = null;
let dbRetryTimer = null;

const connectDatabaseInBackground = () => {
  if (!dbConnectPromise) {
    dbConnectPromise = connectDatabase().catch((error) => {
      logger.error(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
      dbConnectPromise = null;
      if (!shuttingDown) {
        dbRetryTimer = setTimeout(() => { void connectDatabaseInBackground(); }, 5000);
        dbRetryTimer.unref?.();
      }
      return null;
    });
  }

  return dbConnectPromise;
};

const shutdown = async (signal) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearTimeout(dbRetryTimer);
  jobQueue.stop();
  stopMarketingWorker();
  logger.info(`${signal} received. Shutting down gracefully.`);

  try {
    await new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }

      server.close(() => resolve());
    });

    await prisma.$disconnect();
    jobQueue.stop();
  } catch (error) {
    errorMonitor.captureException(error, { lifecycle: "shutdown", signal });
    logger.error(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Crash reports are sent in the background; give them a moment before the process ends.
    await flushErrorReporting();
    process.exit(0);
  }
};

const startServer = () => {
  if (initErrorReporting()) logger.info("Error reporting to Sentry is on");
  getProductionConfigIssues().forEach((issue) => logger.error(`Insecure production configuration: ${issue}`));
  jobQueue.start();
  startMarketingWorker();
  server = app.listen(env.port, () => {
    logger.info(`${env.appName} listening on port ${env.port}`);
    void connectDatabaseInBackground();
  });

  server.on("error", (error) => {
    errorMonitor.captureException(error, { lifecycle: "server_startup" });
    logger.error(`Server startup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  errorMonitor.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    lifecycle: "unhandled_rejection",
  });
  logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});

process.on("uncaughtException", (error) => {
  errorMonitor.captureException(error, { lifecycle: "uncaught_exception" });
  logger.error(`Uncaught exception: ${error instanceof Error ? error.message : String(error)}`);
  void shutdown("uncaughtException");
});

startServer();
