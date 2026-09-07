import env from "../../config/env.js";
import prisma from "./client.js";
import { Prisma } from "@prisma/client";

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
    const columns = await prisma.$queryRaw`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
    `;
    const tables = new Map();
    for (const row of columns) {
      if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
      tables.get(row.table_name).add(row.column_name);
    }
    const models = Prisma.dmmf.datamodel.models;
    const missingTables = [];
    const missingColumns = [];
    for (const model of models) {
      const table = model.dbName || model.name;
      if (!tables.has(table)) {
        missingTables.push(table);
        continue;
      }
      for (const field of model.fields.filter((field) => field.kind !== "object")) {
        const column = field.dbName || field.name;
        if (!tables.get(table).has(column)) missingColumns.push(`${table}.${column}`);
      }
    }
    const healthy = !missingTables.length && !missingColumns.length;
    return {
      provider: env.database.provider,
      healthy,
      checked_tables: models.map((model) => model.dbName || model.name),
      missing_tables: missingTables,
      missing_columns: missingColumns,
      message: healthy ? "Required Prisma tables and columns exist." : "Database schema is behind Prisma. Review and apply pending migrations.",
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
