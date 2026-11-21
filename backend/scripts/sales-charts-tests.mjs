import assert from "node:assert/strict";
import { buildSalesCharts } from "../src/core/dashboard/sales-charts.js";

const now = new Date("2026-10-23T12:00:00Z");
const result = buildSalesCharts([
  { total: 200, refunded_amount: 50, service_mode: "DELIVERY", created_at: "2026-10-23T01:00:00Z" },
  { total: 100, status: "void", created_at: "2026-10-23T02:00:00Z" },
  { total: 100, refunded_amount: 100, created_at: "2026-10-23T02:00:00Z" },
  { total: 80, order_type: "Takeaway", created_at: "2026-10-22T23:59:00Z" },
  { total: 999, created_at: "2026-09-01T12:00:00Z" },
  { total: 999, created_at: "2026-10-24T12:00:00Z" },
  { total: 999, created_at: "invalid" },
], now);
assert.equal(result.rows.length, 30);
assert.equal(result.rows.at(-1).sales, 150);
assert.equal(result.rows.at(-1).bills, 1);
assert.equal(result.rows.at(-2).sales, 80);
assert.equal(result.rows[0].sales, 0);
assert.equal(result.modes.reduce((sum, row) => sum + row.sales, 0), 230);
assert.equal(result.modes.find((row) => row.name === "Delivery").sales, 150);
assert.equal(buildSalesCharts([], now).rows.every((row) => row.sales === 0 && row.bills === 0), true);
console.log("Sales charts: refunds, voids, date boundaries, empty days and service totals passed");
