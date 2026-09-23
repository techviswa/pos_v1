// Uses installed Chrome's isolated DevTools pipe; no browser package required.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import http from "node:http";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { authService } from "../src/core/auth/auth.service.js";
import { kotService } from "../src/features/kitchen/kot/kot.service.js";

const id = `viewport-${randomUUID()}`;
const previousEnabled = env.admincore.enabled;
const previousMode = env.nodeEnv;
const api = http.createServer(app);
const webApp = express();
const build = path.resolve("frontend/build");
webApp.use(express.static(build));
webApp.get("*", (_req, res) => res.sendFile(path.join(build, "index.html")));
const web = http.createServer(webApp);
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
let chrome;
let browserLog = "";
const pending = new Map();
let sequence = 0;
let session;
const findings = [];
try {
  await access(path.join(build, "index.html"));
  env.admincore.enabled = false;
  env.nodeEnv = "production";
  const password = randomUUID();
  await saasService.upsertTenantFromAdminCore({ business_id: id, tenant_id: id, name: "Viewport fixture", plan: "growth", owner_email: `${id}@example.invalid`, owner_password: password });
  const outlet = await prisma.outlet.create({ data: { businessId: id, name: "Test outlet", code: "VIEW" } });
  await prisma.tableManagementSettings.upsert({ where: { businessId: id }, create: { businessId: id, capabilities: { qrOrderingEnabled: true } }, update: { capabilities: { qrOrderingEnabled: true } } });
  const table = await prisma.diningTable.create({ data: { businessId: id, name: "Viewport table", meta: { outlet_id: outlet.id } } });
  const qr = await prisma.tableQrCode.create({ data: { businessId: id, tableId: table.id, token: randomUUID() } });
  const auth = await authService.login({ email: `${id}@example.invalid`, password });
  const restoreIngredient = await prisma.inventoryItem.create({ data: { businessId: id, name: "Unused fixture ingredient", stock: 0, unit: "kg" } });
  await prisma.outletInventory.create({ data: { outletId: outlet.id, inventoryItemId: restoreIngredient.id, stock: 0 } });
  const restoreBill = await prisma.bill.create({ data: { businessId: id, customerName: "Reversal fixture", currency: "INR", total: 100, subtotal: 100, tax: 0, status: "refunded", metadata: { outlet_id: outlet.id, refunded_amount: 100, inventory_consumption: [{ inventory_id: restoreIngredient.id, outlet_id: outlet.id, quantity: 1, unit_cost: 20 }] }, items: { create: [{ name: "Unused meal", price: 100, quantity: 1 }] } } });
  await prisma.product.create({ data: { businessId: id, name: "Viewport meal", category: "Meals", price: 100, costPrice: 30 } });
  const order = await prisma.order.create({ data: { businessId: id, customerName: "Viewport guest", channel: "pos", status: "accepted", metadata: { outlet_id: outlet.id }, items: { create: [{ name: "Viewport meal", quantity: 1, price: 100 }] } } });
  const ticket = await kotService.ensureTicketForOrder({ businessId: id, orderId: order.id });
  assert.ok(auth?.sessionId, "Local fixture login must succeed before browser checks");
  const apiUrl = await listen(api);
  const webUrl = await listen(web);
  const profile = await mkdtemp(path.join(tmpdir(), "pos-chrome-check-"));
  chrome = spawn(process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  chrome.stderr.on("data", (chunk) => { browserLog += chunk.toString(); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const messageId = ++sequence;
    const timer = setTimeout(() => { pending.delete(messageId); reject(new Error(`Browser command timed out: ${method}`)); }, 45000);
    pending.set(messageId, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
  let authenticated = false;
  let wakeInjected = false;
  let readinessProbes = 0;
  let buffer = "";
  chrome.stdio[4].on("data", (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (message.id) {
        const callback = pending.get(message.id);
        if (callback) { clearTimeout(callback.timer); pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); }
      } else if (message.method === "Fetch.requestPaused") {
        void (async () => {
          const { requestId, request } = message.params;
          const url = new URL(request.url);
          if (["XHR", "Fetch"].includes(message.params.resourceType)) console.log(JSON.stringify({ requestPath: url.pathname, method: request.method }));
          if (!wakeInjected && request.method === "GET" && url.pathname === "/api/auth/me") {
            wakeInjected = true;
            await send("Fetch.fulfillRequest", { requestId, responseCode: 503, responseHeaders: [{ name: "Access-Control-Allow-Origin", value: webUrl }, { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify({ message: "Simulated sleeping backend" })).toString("base64") }, session);
            return;
          }
          if (url.pathname.startsWith("/api/") || url.pathname === "/health/ready") {
            if (url.pathname === "/health/ready") readinessProbes++;
            const response = await fetch(`${apiUrl}${url.pathname}${url.search}`, {
              method: request.method, headers: { "Content-Type": "application/json", ...(authenticated ? { "x-cf-session-id": auth.sessionId } : {}) },
              ...(request.postData ? { body: request.postData } : {}),
            });
            const body = await response.text();
            await send("Fetch.fulfillRequest", { requestId, responseCode: response.status,
              responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: webUrl }, { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type,x-cf-session-id,x-outlet-id" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" }], body: Buffer.from(body).toString("base64") }, session);
          } else if (url.origin === webUrl || url.protocol === "data:") await send("Fetch.continueRequest", { requestId }, session);
          else await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, session);
        })().catch((error) => findings.push({ kind: "request", message: error.message }));
      } else if (message.method === "Runtime.exceptionThrown") findings.push({ kind: "runtime", message: message.params.exceptionDetails.text });
    }
  });
  const target = await send("Target.createTarget", { url: "about:blank" });
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await send("Page.enable", {}, session);
  await send("Runtime.enable", {}, session);
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, session);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session)).result.value;
  const results = [];
  for (const width of [390, 768]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true }, session);
    for (const route of ["/login", "/dashboard", "/billing", "/bills", "/chef", "/waiter", "/products", "/reports", "/qr-management", `/qr/${qr.token}`]) {
      authenticated = route !== "/login" && !route.startsWith("/qr/");
      await send("Page.addScriptToEvaluateOnNewDocument", { source: `sessionStorage.setItem('cashflow-lite-tab-session-id',${JSON.stringify(auth.sessionId)});localStorage.setItem('cashflow-lite-active-outlet',${JSON.stringify(outlet.id)});` }, session);
      await send("Page.navigate", { url: `${webUrl}${route}` }, session);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      if (route === "/bills") {
        await evaluate(`document.querySelector('[data-testid="bill-row-${restoreBill.id}"] button').click()`);
        await new Promise((resolve) => setTimeout(resolve, 400));
        assert.ok(await evaluate(`document.body.innerText.includes('Restore unused ingredients')`));
        await evaluate(`document.querySelector('[role="dialog"] form input').focus()`);
        await send("Input.insertText", { text: "Unused ingredients confirmed by manager" }, session);
        await evaluate(`document.querySelector('[role="dialog"] input[type="checkbox"]').click(); document.querySelector('[role="dialog"] form').requestSubmit()`);
        await new Promise((resolve) => setTimeout(resolve, 800));
        assert.ok(await evaluate(`document.body.innerText.includes('restored to their original stock location')`));
        assert.equal((await prisma.outletInventory.findUnique({ where: { outletId_inventoryItemId: { outletId: outlet.id, inventoryItemId: restoreIngredient.id } } })).stock, 1);
      }
      if (route === "/chef") {
        assert.ok(await evaluate(`document.body.innerText.includes('Viewport meal')`), "Chef must render the fixture ticket");
        await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='History').click()`);
        await new Promise((resolve) => setTimeout(resolve, 800));
        const expectedHistory = await kotService.getHistory({ tenantId: id, ticketId: ticket.id });
        assert.ok(expectedHistory.audit.length > 0);
        assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Kitchen ticket history"] li').length`), expectedHistory.audit.length, "Chef history must display actual audit records");
      }
      if (route.startsWith("/qr/")) assert.ok(await evaluate(`document.body.innerText.includes('Viewport meal')`), "Public menu must show the available product");
      if (route === "/billing" && width === 390) {
        await evaluate(`[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Cashier shift')).click()`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        for (const expectedButton of ["Open shift", "Close & save settlement"]) {
          assert.ok(await evaluate(`document.body.innerText.includes(${JSON.stringify(expectedButton)})`), `Missing settlement action: ${expectedButton}`);
          await evaluate(`document.querySelector('details input[type=number]').focus()`);
          await send("Input.insertText", { text: "50" }, session);
          await evaluate(`document.querySelector('details form').requestSubmit()`);
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        assert.equal(await prisma.stateDocument.count({ where: { key: { startsWith: "shift-history:" }, data: { path: ["business_id"], equals: id } } }), 1);
        console.log("Browser settlement open/count/close/history passed");
      }
      const result = await evaluate(`({route:location.pathname,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+2,apiErrors:[...document.querySelectorAll('.cf-api-error')].map(e=>e.innerText),body:document.body.innerText.slice(0,200),elements:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+2&&r.left>=0}).slice(0,6).map(e=>({tag:e.tagName,class:e.className}))})`);
      results.push({ requested: route, viewport: width, ...result });
      console.log(JSON.stringify(results.at(-1)));
      if (width === 390 && ["/billing", "/chef"].includes(route)) {
        const capture = await send("Page.captureScreenshot", { format: "png" }, session);
        await writeFile(`backend/logs/mobile-${route.slice(1)}.png`, Buffer.from(capture.data, "base64"));
      }
    }
  }
  await writeFile("backend/logs/mobile-viewport-results.json", JSON.stringify({ results, findings }, null, 2));
  assert.equal(findings.length, 0, "Browser runtime/request failures detected");
  assert.ok(wakeInjected && readinessProbes >= 1, "A temporary auth failure must trigger readiness recovery");
  assert.ok(results.every((result) => result.route === result.requested), "A requested screen redirected instead of rendering");
  assert.ok(results.every((result) => result.width === result.viewport && !result.body.includes("ENOENT")), "Application did not render at the requested viewport");
  assert.ok(results.every((result) => result.apiErrors.length === 0), "A screen rendered an API error fallback");
  assert.ok(results.every((result) => !result.overflow), "Viewport overflow detected");
} finally {
  await writeFile("backend/logs/mobile-browser-stderr.log", browserLog);
  chrome?.kill();
  for (const value of pending.values()) clearTimeout(value.timer);
  await Promise.all([api, web].filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve))));
  env.admincore.enabled = previousEnabled;
  env.nodeEnv = previousMode;
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.business.deleteMany({ where: { id } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId: id } });
  await prisma.$disconnect();
}
