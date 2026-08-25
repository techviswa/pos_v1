import env from "../../config/env.js";
import prisma from "./client.js";

export const REQUIRED_SQLITE_TABLES = [
  "Business",
  "Role",
  "Permission",
  "User",
  "Outlet",
  "Product",
  "Order",
  "Bill",
  "InventoryItem",
  "DiningArea",
  "DiningTable",
  "TableReservation",
  "TableManagementSettings",
  "TableQrCode",
  "TableQrScanEvent",
];

const listSqliteTables = async () => {
  const rows = await prisma.$queryRaw`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `;

  return rows.map((row) => row.name);
};

export const checkPrismaSchemaHealth = async () => {
  await prisma.$connect();

  if (env.database.provider !== "sqlite") {
    return {
      provider: env.database.provider,
      healthy: true,
      checked_tables: [],
      missing_tables: [],
      message: "Schema table introspection is only enabled for sqlite in this dev project.",
    };
  }

  const existingTables = await listSqliteTables();
  const existingTableSet = new Set(existingTables);
  const missingTables = REQUIRED_SQLITE_TABLES.filter((tableName) => !existingTableSet.has(tableName));

  return {
    provider: env.database.provider,
    healthy: missingTables.length === 0,
    checked_tables: REQUIRED_SQLITE_TABLES,
    missing_tables: missingTables,
    existing_table_count: existingTables.length,
    message: missingTables.length
      ? "Database schema is behind the Prisma schema. Run migrations/reset before production testing."
      : "Database schema matches the required POS tables.",
  };
};

