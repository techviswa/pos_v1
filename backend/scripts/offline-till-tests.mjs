// End-to-end offline till check in installed Chrome (DevTools pipe; no browser package required).
// Run from the POS root after `npm --prefix frontend run build`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
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
import { stopRealtime } from "../src/services/realtime/realtime.service.js";
import { connectDatabase } from "../src/config/db.js";

const id = `offline-${randomUUID()}`;
const previousEnabled = env.admincore.enabled;
const api = http.createServer(app);
const build = path.resolve("frontend/build");
const webApp = express();
webApp.use(express.static(build));
webApp.get("*", (_req, res) => res.sendFile(path.join(build, "index.html")));
const web = http.createServer(webApp);
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = new Map();
let chrome;
let sequence = 0;
let session;
let apiReachable = true;
const pageErrors = [];

try {
  await access(path.join(build, "service-worker.js"));
  await connectDatabase();
  env.admincore.enabled = false;
  const password = randomUUID();
  await saasService.upsertTenantFromAdminCore({ business_id: id, tenant_id: id, name: "Offline fixture", plan: "growth", owner_email: `${id}@example.invalid`, owner_password: password });
  await prisma.outlet.create({ data: { businessId: id, name: "Offline outlet", code: "OFFL" } });
  const product = await prisma.product.create({ data: { businessId: id, name: "Offline tea", category: "Drinks", price: 50, stock: 3 } });
  const auth = await authService.login({ email: `${id}@example.invalid`, password });
  assert.ok(auth?.sessionId);

  const apiUrl = await listen(api);
  const webUrl = await listen(web);
  const profile = await mkdtemp(path.join(tmpdir(), "pos-offline-check-"));
  chrome = spawn(process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--remote-debugging-pipe", `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const messageId = ++sequence;
    const timer = setTimeout(() => { pending.delete(messageId); reject(new Error(`Browser command timed out: ${method}`)); }, 45000);
    pending.set(messageId, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });

  let buffer = "";
  chrome.stdio[4].on("data", (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id) {
        const callback = pending.get(message.id);
        if (callback) { clearTimeout(callback.timer); pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); }
      } else if (message.method === "Fetch.requestPaused") {
        void (async () => {
          const { requestId, request } = message.params;
          const url = new URL(request.url);
          const isApi = url.origin !== webUrl && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/health"));
          if (!isApi) return send("Fetch.continueRequest", { requestId }, session);
          // The event stream cannot be proxied (it never ends), and while "offline" nothing reaches the server.
          if (!apiReachable || url.pathname === "/api/events/stream") {
            return send("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" }, session);
          }
          const response = await fetch(`${apiUrl}${url.pathname}${url.search}`, {
            method: request.method,
            headers: { "Content-Type": "application/json", ...(request.headers["x-cf-session-id"] ? { "x-cf-session-id": request.headers["x-cf-session-id"] } : {}) },
            ...(request.postData ? { body: request.postData } : {}),
          });
          const body = await response.text();
          return send("Fetch.fulfillRequest", { requestId, responseCode: response.status, responseHeaders: [
            { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: webUrl },
            { name: "Access-Control-Allow-Credentials", value: "true" }, { name: "Access-Control-Allow-Headers", value: "content-type,x-cf-session-id,x-outlet-id" },
            { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
          ], body: Buffer.from(body).toString("base64") }, session);
        })().catch((error) => pageErrors.push(`request: ${error.message}`));
      } else if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      }
    }
  });

  const target = await send("Target.createTarget", { url: "about:blank" });
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await send("Page.enable", {}, session);
  await send("Runtime.enable", {}, session);
  await send("Network.enable", {}, session);
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, session);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `if (!sessionStorage.getItem('cashflow-lite-tab-session-id')) sessionStorage.setItem('cashflow-lite-tab-session-id', ${JSON.stringify(auth.sessionId)});` }, session);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session)).result.value;
  const waitFor = async (expression, label, timeoutMs = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(300);
    }
    throw new Error(`Timed out waiting for: ${label}\n${(await evaluate("document.body.innerText").catch(() => "")).slice(0, 600)}`);
  };
  const setOffline = (offline) => send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, session);
  const card = `document.querySelector('[data-testid="product-card-${product.id}"]')`;
  // A product may open a customisation dialog first; confirm it so exactly one unit goes into the cart.
  const addOne = async () => {
    await evaluate(`${card}.click(); true`);
    await sleep(300);
    await evaluate(`(() => { const button = [...document.querySelectorAll('[role="dialog"] button')].find((node) => node.textContent.trim() === 'Add to Cart'); if (button) button.click(); return true; })()`);
    await waitFor(`!document.querySelector('[role="dialog"]')`, "customisation dialog closed", 5000);
  };
  const queue = `Object.keys(localStorage).filter((key) => key.startsWith('cashflow-offline-bills:')).flatMap((key) => JSON.parse(localStorage.getItem(key)))`;

  // 1. Online: the till loads, installs offline support and keeps a copy of the menu.
  await send("Page.navigate", { url: `${webUrl}/billing` }, session);
  await waitFor(`Boolean(${card})`, "menu online");
  await waitFor("Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)", "service worker in control");
  await waitFor(`Object.keys(localStorage).some((key) => key.startsWith('cashflow-offline-data:') && key.includes(':billing:'))`, "menu copy saved");

  // 2. Connection lost and the page reloaded: the app still opens from the device and keeps selling.
  apiReachable = false;
  await new Promise((resolve) => web.close(resolve));
  web.closeAllConnections?.();
  await setOffline(true);
  await send("Page.reload", { ignoreCache: false }, session);
  await waitFor(`Boolean(${card}) && document.body.innerText.includes('Offline till')`, "offline menu after reload");

  await addOne();
  await addOne();
  await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Delivery').click(); true`);
  const fill = (label, value) => evaluate(`(() => {
    const field = [...document.querySelectorAll('.cf-field')].find((node) => node.querySelector('label')?.textContent.trim() === ${JSON.stringify(label)});
    const input = field.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await fill("Customer Name", "Offline guest");
  await fill("Phone", "9876543210");
  await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Generate Bill')).click(); true`);
  await waitFor(`document.body.innerText.includes('Provisional receipt taken offline')`, "offline receipt");
  assert.ok(await evaluate(`document.body.innerText.includes('hand it to the kitchen')`), "the offline receipt tells staff to take it to the kitchen");
  const queued = await evaluate(queue);
  assert.equal(queued.length, 1, "one bill is waiting on the device");
  assert.equal(queued[0].status, "pending");
  assert.equal(await prisma.bill.count({ where: { businessId: id } }), 0, "nothing reached the server while offline");

  // 3. Another reload while still offline: the queued sale survives and its units stay sold on this till.
  await send("Page.reload", { ignoreCache: false }, session);
  await waitFor(`Boolean(${card}) && document.body.innerText.includes('Offline till')`, "offline menu after second reload");
  assert.equal((await evaluate(queue)).length, 1);
  assert.equal(await evaluate(`${card}.disabled`), false, "one unit is still available");
  await addOne();
  await waitFor(`${card}.disabled`, "last unit reserved in the cart");

  // 4. Back online: the queued bill syncs exactly once and the server re-prices it.
  apiReachable = true;
  await setOffline(false);
  await evaluate("window.dispatchEvent(new Event('online')); true");
  const started = Date.now();
  while (Date.now() - started < 40000 && (await prisma.bill.count({ where: { businessId: id } })) === 0) await sleep(500);
  await waitFor(`${queue}.length === 0`, "queue drained", 20000);
  await evaluate("window.dispatchEvent(new Event('online')); true");
  await sleep(2000);
  const bills = await prisma.bill.findMany({ where: { businessId: id } });
  assert.equal(bills.length, 1, "the offline bill is recorded once");
  assert.equal(Number(bills[0].total), 118, "2 x 50 + 18% GST, priced by the server");
  assert.ok(bills[0].metadata.offline_created_at, "the original offline time is kept");
  assert.equal(bills[0].metadata.client_request_id, queued[0].id);
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).stock, 1, "stock reflects the offline sale");
  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(" | ")}`);
  console.log("Offline till passed: reload without a connection, offline sale, stock hold, persistence across reloads, single sync");
} finally {
  chrome?.kill();
  for (const value of pending.values()) clearTimeout(value.timer);
  await stopRealtime();
  api.closeAllConnections?.();
  await Promise.all([api, web].filter((server) => server.listening).map((server) => new Promise((resolve) => server.close(resolve))));
  env.admincore.enabled = previousEnabled;
  const users = await prisma.user.findMany({ where: { businessId: id }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.business.deleteMany({ where: { id } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } });
  await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId: id } });
  await prisma.$disconnect();
}
