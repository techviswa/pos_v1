import env from "./env.js";
import prisma from "../database/prisma/client.js";
import { checkPrismaSchemaHealth } from "../database/prisma/schema-health.js";
import { logger } from "../shared/utils/logger.js";

export const dbConfig = {
  provider: env.database.provider,
  url: env.database.url,
  name: env.database.name,
};

let activeConnection = null;
let databaseAvailable = false;

export const connectDatabase = async () => {
  if (activeConnection) {
    return activeConnection;
  }

  await prisma.$connect();

  activeConnection = {
    ...dbConfig,
    readyState: "connected",
  };
  databaseAvailable = true;

  logger.info(`Database connected using ${dbConfig.provider} at ${dbConfig.url}`);

  try {
    const schemaHealth = await checkPrismaSchemaHealth();
    if (!schemaHealth.healthy) {
      logger.warn(
        `Database schema mismatch: missing tables ${schemaHealth.missing_tables.join(", ")}. Run npm --prefix backend run db:setup or db:reset:dev.`,
      );
    }
  } catch (error) {
    logger.warn(`Database schema health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return activeConnection;
};

export const isDatabaseAvailable = () => databaseAvailable;

export default dbConfig;
