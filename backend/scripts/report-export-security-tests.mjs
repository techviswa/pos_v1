import assert from "node:assert/strict";
import { reportsService } from "../src/core/reports/reports.service.js";

const original = reportsService.getReportByKey;
try {
  reportsService.getReportByKey = async () => ({ rows: [
    { name: '=HYPERLINK("https://example.invalid","Click")', amount: -12.5 },
    { name: '\t +SUM(1,2)', amount: 10 },
    { name: '@SUM(1,2)', amount: 0 },
    { name: '-1+2', amount: 1 },
    { name: '</pre><img src=x onerror=alert(1)>', amount: 3 },
    { name: 'Plain "quoted", name', amount: 4 },
  ] });
  const csv = await reportsService.exportReport({ key: 'products', format: 'csv' });
  assert.ok(csv.content.includes('"\'=HYPERLINK(""https://example.invalid"",""Click"")"'));
  for (const text of ['\t +SUM(1,2)', '@SUM(1,2)', '-1+2']) assert.ok(csv.content.includes(`"'${text}"`));
  assert.ok(csv.content.includes('"-12.5"'), 'Numeric negative amounts must remain numeric');
  assert.ok(csv.content.includes('"Plain ""quoted"", name"'));
  const html = await reportsService.exportReport({ key: '<script>alert(1)</script>', format: 'pdf' });
  assert.ok(!html.content.includes('<script>'));
  assert.ok(!html.content.includes('<img'));
  assert.ok(html.content.includes('&lt;img'));
  assert.ok(html.content.includes('&lt;script&gt;'));
  console.log('Report exports neutralize spreadsheet formulas and HTML markup; numeric amounts and CSV quotes are preserved.');
} finally {
  reportsService.getReportByKey = original;
}
