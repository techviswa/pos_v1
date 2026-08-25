import dotenv from "dotenv";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const candidatePaths = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
  path.resolve(process.cwd(), ".env"),
];
const envFilePath = candidatePaths.find((candidate) => existsSync(candidate));

if (envFilePath) {
  dotenv.config({ path: envFilePath });
}

const parseNumber = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["true", "1", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const parseCorsOrigins = (value) => {
  if (!value || value.trim() === "*") {
    return "*";
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const backendPort = parseNumber(process.env.PORT, 4000);

export const env = {
  appName: process.env.APP_NAME || "POS SaaS Backend",
  nodeEnv: process.env.NODE_ENV || "development",
  port: backendPort,
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  defaultTenantId: process.env.DEFAULT_TENANT_ID || "demo-tenant",
  defaultBusinessId: process.env.DEFAULT_BUSINESS_ID || "demo-business",
  auth: {
    jwtSecret: process.env.JWT_SECRET || "change-me",
    adminEmail: process.env.ADMIN_EMAIL || "owner@pos.com",
    adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  },
  database: {
    provider: process.env.DATABASE_PROVIDER || "postgresql",
    url:
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/pos_saas?schema=public",
    name: process.env.DATABASE_NAME || process.env.DB_NAME || "pos_saas",
  },
  admincore: {
    enabled: parseBoolean(process.env.ADMINCORE_ENABLED, false),
    apiBaseUrl: process.env.ADMINCORE_API_BASE_URL || "",
    apiKey: process.env.ADMINCORE_API_KEY || "",
    posBaseUrl: process.env.POS_BASE_URL || `http://localhost:${backendPort}`,
  },
  qrOrdering: {
    publicBaseUrl:
      process.env.QR_PUBLIC_BASE_URL ||
      process.env.PUBLIC_QR_BASE_URL ||
      process.env.POS_PUBLIC_URL ||
      process.env.POS_BASE_URL ||
      `http://localhost:${backendPort}`,
  },
};

export default env;
