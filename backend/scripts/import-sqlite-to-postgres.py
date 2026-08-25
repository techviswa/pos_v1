import argparse
import json
import os
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


TABLE_ORDER = [
    "Business",
    "Role",
    "Permission",
    "RolePermission",
    "User",
    "Outlet",
    "UserPermission",
    "UserOutletAssignment",
    "Product",
    "Variation",
    "Addon",
    "Order",
    "OrderItem",
    "Bill",
    "BillItem",
    "InventoryItem",
    "OutletProduct",
    "OutletInventory",
    "OutletFeatureToggle",
    "InventoryMovement",
    "PurchaseOrder",
    "RoutePlan",
    "Allocation",
    "RouteStop",
    "KitchenTicket",
    "Batch",
    "TableManagementSettings",
    "DiningArea",
    "DiningTable",
    "TableQrCode",
    "TableQrScanEvent",
    "TableReservation",
    "Feedback",
    "FeatureToggle",
    "StaffActivity",
]

JSON_COLUMNS = {
    "bio",
    "channelSettings",
    "outletOverrides",
    "removalOptions",
    "recipeLines",
    "addons",
    "metadata",
    "items",
    "capabilities",
    "reservationRules",
    "uiPreferences",
    "meta",
}

TIMESTAMP_COLUMNS = {
    "createdAt",
    "updatedAt",
    "expiryDate",
    "requiredBy",
    "dispatchDate",
    "reservationDate",
    "confirmedAt",
    "releasedAt",
    "canceledAt",
    "rotatedAt",
    "lastScannedAt",
    "scannedAt",
}

BOOLEAN_COLUMNS = {
    "profileRequired",
    "active",
    "enabled",
}


def sql_ident(value):
    return '"' + value.replace('"', '""') + '"'


def sql_string(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "''") + "'"


def normalize_timestamp(value):
    if value is None or value == "":
        return None

    if isinstance(value, (int, float)):
        timestamp = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).replace(tzinfo=None).isoformat(sep=" ")

    text = str(value)
    if text.isdigit():
        number = int(text)
        timestamp = number / 1000 if number > 10_000_000_000 else number
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).replace(tzinfo=None).isoformat(sep=" ")

    return text.replace("T", " ").replace("Z", "")


def normalize_json(value):
    if value is None or value == "":
        return None

    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = value
    else:
        parsed = value

    return json.dumps(parsed, separators=(",", ":"))


def sql_literal(column, value):
    if value is None:
        return "NULL"

    if column in BOOLEAN_COLUMNS:
        if isinstance(value, str):
            return "TRUE" if value.strip().lower() in {"1", "true", "t", "yes", "on"} else "FALSE"
        return "TRUE" if bool(value) else "FALSE"

    if column in JSON_COLUMNS:
        normalized = normalize_json(value)
        return "NULL" if normalized is None else f"{sql_string(normalized)}::jsonb"

    if column in TIMESTAMP_COLUMNS:
        normalized = normalize_timestamp(value)
        return "NULL" if normalized is None else f"{sql_string(normalized)}::timestamp"

    if isinstance(value, (int, float)):
        return str(value)

    return sql_string(value)


def sqlite_tables(sqlite_path):
    with sqlite3.connect(sqlite_path) as connection:
        rows = connection.execute(
            "select name from sqlite_master where type='table' and name not like 'sqlite_%'"
        ).fetchall()
    return {row[0] for row in rows}


def sqlite_columns(connection, table):
    return [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")').fetchall()]


def postgres_columns(psql, database_url):
    query = """
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY ordinal_position;
    """
    result = subprocess.run(
        [psql, database_url, "-At", "-F", "\t", "-c", query],
        check=True,
        text=True,
        capture_output=True,
    )
    columns = {}
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        table, column = line.split("\t", 1)
        columns.setdefault(table, []).append(column)
    return columns


def build_sql(sqlite_path, pg_columns):
    available_tables = sqlite_tables(sqlite_path)
    tables = [table for table in TABLE_ORDER if table in available_tables and table in pg_columns]

    statements = [
        "BEGIN;",
        "SET CONSTRAINTS ALL DEFERRED;",
        "TRUNCATE TABLE "
        + ", ".join(sql_ident(table) for table in reversed(tables))
        + " RESTART IDENTITY CASCADE;",
    ]
    counts = {}

    with sqlite3.connect(sqlite_path) as connection:
        connection.row_factory = sqlite3.Row
        for table in tables:
            source_columns = sqlite_columns(connection, table)
            columns = [column for column in pg_columns[table] if column in source_columns]
            if not columns:
                continue

            rows = connection.execute(
                f'SELECT {", ".join(sql_ident(column) for column in columns)} FROM {sql_ident(table)}'
            ).fetchall()
            counts[table] = len(rows)

            if not rows:
                continue

            column_sql = ", ".join(sql_ident(column) for column in columns)
            for row in rows:
                values_sql = ", ".join(sql_literal(column, row[column]) for column in columns)
                statements.append(f"INSERT INTO {sql_ident(table)} ({column_sql}) VALUES ({values_sql});")

    statements.append("COMMIT;")
    return "\n".join(statements) + "\n", counts


def main():
    parser = argparse.ArgumentParser(description="Import old SQLite POS data into the current PostgreSQL database.")
    parser.add_argument("--sqlite", default="backend/prisma/dev.db")
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--psql", default=r"C:\Program Files\PostgreSQL\18\bin\psql.exe")
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite database not found: {sqlite_path}")

    pg_columns = postgres_columns(args.psql, args.database_url)
    sql, counts = build_sql(sqlite_path, pg_columns)

    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as file:
        file.write(sql)
        sql_path = file.name

    try:
        subprocess.run([args.psql, args.database_url, "-v", "ON_ERROR_STOP=1", "-f", sql_path], check=True)
    finally:
        try:
            os.remove(sql_path)
        except OSError:
            pass

    print("Imported rows:")
    for table in TABLE_ORDER:
        if table in counts:
            print(f"{table}: {counts[table]}")


if __name__ == "__main__":
    main()
