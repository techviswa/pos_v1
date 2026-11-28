// Production-scale benchmark on an isolated fixture business (never touches real businesses).
//   node scripts/scale-bench.mjs seed    one year of a busy two-outlet cafe (~120k bills, ~360k lines, 200k stock movements)
//   node scripts/scale-bench.mjs bench   times the hot endpoints and concurrent billing against that fixture
//   node scripts/scale-bench.mjs clean   deletes the fixture
// The fixture id and login live in backend/data/scale-bench.json (ignored).
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { usersService } from "../src/core/users/users.service.js";
import { billingService } from "../src/core/billing/billing.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const stateFile = new URL("../data/scale-bench.json", import.meta.url);
const mode = process.argv[2];
const DAYS = Number(process.env.BENCH_DAYS || 365), BILLS_PER_DAY = Number(process.env.BENCH_BILLS_PER_DAY || 330);
const IST = 5.5 * 3600000;
await connectDatabase();

async function seed() {
  const id = `bench-${randomUUID().slice(0, 8)}`, tenantId = `tenant-${id}`, password = randomUUID();
  await prisma.business.create({ data: { id, tenantId, name: "Scale Bench Cafe" } });
  await saasService.updateSubscription({ businessId: id, payload: { plan: "enterprise", subscription_status: "active" } });
  const outlets = await Promise.all(["Main", "Second"].map((name, index) => prisma.outlet.create({ data: { businessId: id, name, code: `SB${index}${id.slice(-4)}` } })));
  const products = [];
  for (let index = 0; index < 60; index += 1) products.push(await prisma.product.create({ data: { businessId: id, name: `Item ${index + 1}`, category: ["Coffee", "Tea", "Snacks", "Meals", "Desserts"][index % 5], price: 40 + (index % 12) * 15, costPrice: 15 + (index % 12) * 5, stock: 1000000 } }));
  const inventory = [];
  for (let index = 0; index < 40; index += 1) inventory.push(await prisma.inventoryItem.create({ data: { businessId: id, name: `Stock ${index + 1}`, unit: "kg", stock: 100000 } }).catch(async () => prisma.inventoryItem.create({ data: { businessId: id, name: `Stock ${index + 1}`, stock: 100000 } })));
  const owner = await usersService.createUser({ businessId: id, tenantId, payload: { email: `owner-${id}@bench.test`, password, role: "Owner", name: "Owner", profile_required: false } });
  const cashiers = [];
  for (const outlet of outlets) cashiers.push(await usersService.createUser({ businessId: id, tenantId, payload: { email: `cashier-${outlet.code.toLowerCase()}-${id}@bench.test`, password, role: "Cashier", name: `Cashier ${outlet.name}`, profile_required: false, assigned_outlet_ids: [outlet.id] } }));
  // One real bill through the billing service gives the exact stored shape; synthetic bills copy it.
  const real = await billingService.createInvoice({ tenantId, user: cashiers[0], payload: { items: [{ product_id: products[0].id, quantity: 1 }], payment_type: "Cash", outlet_id: outlets[0].id } });
  const template = await prisma.bill.findUnique({ where: { id: real.id } });
  const start = Date.now() - DAYS * 86400000;
  let number = 1;
  for (let day = 0; day < DAYS; day += 1) {
    const bills = [], items = [];
    const dayStart = Math.floor((start + day * 86400000 + IST) / 86400000) * 86400000 - IST; // local midnight
    for (let n = 0; n < BILLS_PER_DAY; n += 1) {
      const billId = randomUUID(), outlet = outlets[n % 2], cashier = cashiers[n % 2];
      // Opening 07:00 to 23:30 local, busier at lunch and evening.
      const minute = 420 + Math.floor((Math.sin(n) + 1) / 2 * 990);
      const createdAt = new Date(dayStart + minute * 60000 + (n % 60) * 1000);
      let subtotal = 0;
      const lines = [0, 1, 2].map((k) => { const product = products[(n * 7 + k * 13 + day) % products.length]; const quantity = 1 + ((n + k) % 3); subtotal += Number(product.price) * quantity; return { id: randomUUID(), billId, productId: product.id, name: product.name, quantity, price: product.price }; });
      const tax = Math.round(subtotal * 0.05 * 100) / 100, total = subtotal + tax;
      const metadata = { ...(template.metadata || {}), outlet_id: outlet.id, outletId: outlet.id, created_by: cashier.id, created_by_name: cashier.name, invoice_number: `SB-${String(number).padStart(7, "0")}`,
        payments: [{ id: randomUUID(), method: n % 3 ? "Cash" : "UPI", amount: total, status: "confirmed", confirmed_at: createdAt.toISOString() }], subtotal, tax, total };
      bills.push({ id: billId, businessId: id, customerName: "Walk-in", currency: "INR", subtotal, tax, total, status: "paid", invoiceNumber: `SB-${String(number).padStart(7, "0")}`, metadata, createdAt, updatedAt: createdAt });
      items.push(...lines);
      number += 1;
    }
    await prisma.bill.createMany({ data: bills });
    await prisma.billItem.createMany({ data: items });
    const movements = Array.from({ length: Math.round(BILLS_PER_DAY * 1.7) }, (_, n) => ({ businessId: id, inventoryItemId: inventory[n % inventory.length].id, movementType: "sale", quantity: -0.2, outletId: outlets[n % 2].id, createdAt: new Date(dayStart + (420 + (n % 990)) * 60000) }));
    await prisma.inventoryMovement.createMany({ data: movements });
    if (day % 30 === 0) console.log(`seeded day ${day + 1}/${DAYS}`);
  }
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ id, tenantId, password, owner: owner.email, cashiers: cashiers.map((user) => user.email), outlets: outlets.map((outlet) => outlet.id), products: products.map((product) => product.id) }, null, 2));
  console.log(`Seeded ${id}: ${await prisma.bill.count({ where: { businessId: id } })} bills, ${await prisma.billItem.count({ where: { bill: { businessId: id } } })} lines, ${await prisma.inventoryMovement.count({ where: { businessId: id } })} stock movements`);
}

async function bench() {
  const fixture = JSON.parse(readFileSync(stateFile, "utf8"));
  const { default: app } = await import("../src/app.js");
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, session) => {
    const started = performance.now();
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    return { status: response.status, ms: performance.now() - started, bytes: text.length, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const login = async (email) => (await call("POST", "/api/auth/login", { email, password: fixture.password })).json?.data?.session_id;
  const owner = await login(fixture.owner);
  const cashiers = await Promise.all(fixture.cashiers.map(login));
  const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() + IST - n * 86400000).toISOString().slice(0, 10);
  const month = `from=${daysAgo(29)}&to=${today}`, year = `from=${daysAgo(364)}&to=${today}`;
  const reads = [
    ["Bills list (page of 50)", `/api/billing?limit=50`],
    ["Billing summary", `/api/billing/summary`],
    ["Dashboard", `/api/dashboard/stats`],
    ["Reports overview, today", `/api/reports?from=${today}&to=${today}&guests=0`],
    ["Reports overview + guests, 30 days", `/api/reports?${month}`],
    ["Reports overview, 30 days", `/api/reports?${month}&guests=0`],
    ["Reports overview, 1 year", `/api/reports?${year}&guests=0`],
    ["Reports overview, no dates", `/api/reports`],
    ["GST report, 30 days", `/api/reports/gst?${month}`],
    ["Hourly sales, 30 days", `/api/reports/hourly-sales?${month}`],
    ["Profitability, 30 days", `/api/reports/profitability?${month}`],
    ["Staff performance, 30 days", `/api/reports/staff-performance?${month}`],
    ["Outlet comparison, 30 days", `/api/reports/outlet-comparison?${month}`],
    ["GST export CSV, 30 days", `/api/reports/exports/gst?format=csv&${month}`],
    ["Inventory list", `/api/inventory`],
    ["Products", `/api/products`],
  ];
  const results = [];
  for (const [name, path] of reads) {
    const runs = [];
    let last;
    for (let run = 0; run < 3; run += 1) { last = await call("GET", path, null, owner); runs.push(last.ms); }
    runs.sort((a, b) => a - b);
    results.push({ name, status: last.status, median_ms: Math.round(runs[1]), kb: Math.round(last.bytes / 1024) });
  }
  for (const [name, path] of [["Cashier: bills list", "/api/billing?limit=50"], ["Cashier: bills list, paged", "/api/billing?limit=50&paged=true"], ["Cashier: dashboard", "/api/dashboard/stats"]]) {
    const runs = []; let last;
    for (let run = 0; run < 3; run += 1) { last = await call("GET", path, null, cashiers[0]); runs.push(last.ms); }
    runs.sort((a, b) => a - b);
    results.push({ name, status: last.status, median_ms: Math.round(runs[1]), kb: Math.round(last.bytes / 1024) });
  }
  // Concurrent billing: 40 bills, 20 at a time per outlet, against the same products.
  const productBefore = await prisma.product.findUnique({ where: { id: fixture.products[5] }, select: { stock: true } });
  const countBefore = await prisma.bill.count({ where: { businessId: fixture.id } });
  const started = performance.now();
  const created = await Promise.all(Array.from({ length: 40 }, (_, n) => call("POST", "/api/billing", { items: [{ product_id: fixture.products[5], quantity: 1 }], payment_type: "Cash", outlet_id: fixture.outlets[n % 2] }, cashiers[n % 2])));
  const burstMs = performance.now() - started;
  const ok = created.filter((row) => row.status === 201 || row.status === 200);
  const numbers = ok.map((row) => row.json?.data?.invoice_number || row.json?.data?.metadata?.invoice_number || row.json?.invoice_number).filter(Boolean);
  const productAfter = await prisma.product.findUnique({ where: { id: fixture.products[5] }, select: { stock: true } });
  const single = []; for (let n = 0; n < 5; n += 1) single.push((await call("POST", "/api/billing", { items: [{ product_id: fixture.products[6], quantity: 1 }], payment_type: "Cash", outlet_id: fixture.outlets[0] }, cashiers[0])).ms);
  single.sort((a, b) => a - b);
  console.table(results);
  console.log(JSON.stringify({
    bills_in_fixture: countBefore,
    concurrent_billing: { requested: 40, succeeded: ok.length, failures: created.filter((row) => !ok.includes(row)).map((row) => `${row.status} ${row.json?.error?.message || row.json?.message || ""}`).slice(0, 5),
      unique_invoice_numbers: new Set(numbers).size, numbers_returned: numbers.length, stock_drop: productBefore.stock - productAfter.stock, total_ms: Math.round(burstMs), avg_ms_per_bill: Math.round(burstMs / 40) },
    single_bill_median_ms: Math.round(single[2]), memory_mb: Math.round(process.memoryUsage().rss / 1048576),
  }, null, 2));
  server.close();
}

async function clean() {
  if (!existsSync(stateFile)) return console.log("No fixture recorded");
  const { id } = JSON.parse(readFileSync(stateFile, "utf8"));
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } });
  await prisma.business.deleteMany({ where: { id } });
  rmSync(stateFile);
  console.log(`Deleted ${id}; remaining: ${await prisma.business.count({ where: { id } })}`);
}

try {
  if (mode === "seed") await seed(); else if (mode === "bench") await bench(); else if (mode === "clean") await clean();
  else console.log("Usage: node scripts/scale-bench.mjs seed|bench|clean");
} finally { await stopRealtime(); await prisma.$disconnect(); }
process.exit(0);
