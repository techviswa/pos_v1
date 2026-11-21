import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fillSalesDays } from "./salesSeries";
import { SalesVisuals } from "./SalesVisuals";

test("quiet days are zero-filled in chronological order without changing totals", () => {
  const rows = fillSalesDays([{ date: "2026-10-03", sales: 20, bills: 1 }, { date: "2026-10-01", sales: 100, bills: 2 }]);
  expect(rows.map((row) => row.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  expect(rows[1]).toEqual({ date: "2026-10-02", sales: 0, bills: 0 });
  expect(rows.reduce((sum, row) => sum + row.sales, 0)).toBe(120);
});

test("empty analytics explain missing data without invalid numbers", () => {
  const html = renderToStaticMarkup(<SalesVisuals currency="INR" periodLabel="Today" />);
  expect(html).toContain("No sales recorded in this period");
  expect(html).toContain("This is not profit");
  expect(html).not.toMatch(/NaN|Infinity/);
});

test("dashboard service mix stays visible with an honest empty donut", () => {
  const html = renderToStaticMarkup(<SalesVisuals showServiceMix currency="INR" periodLabel="Last 30 days" />);
  expect(html).toContain("How customers order");
  expect(html).toContain("Service shares will appear after a bill is recorded");
  expect(html).not.toContain("When customers buy");
});

test("rankings sort by sales and disclose their basis", () => {
  const html = renderToStaticMarkup(<SalesVisuals currency="INR" periodLabel="This month" products={[{ name: "Small seller", value: 10 }, { name: "Big seller", value: 200 }]} />);
  expect(html.indexOf("Big seller")).toBeLessThan(html.indexOf("Small seller"));
  expect(html).toContain("excluding tax");
  expect(html).toContain("View exact daily figures");
});
