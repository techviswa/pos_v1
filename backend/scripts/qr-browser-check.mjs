import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(tmpdir(), "pos-qr-browser-"));
const chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let socket;
const pending = new Map();
let sequence = 0;
const unexpectedAuthRequests = [];
const frontendOrigin = process.env.QR_BROWSER_FRONTEND_ORIGIN || "http://localhost:3002";
try {
  let port;
  for (let attempt = 0; attempt < 60 && !port; attempt++) {
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { await pause(500); }
  }
  assert.ok(port, "Chrome debugging endpoint did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Fetch.requestPaused") {
      unexpectedAuthRequests.push(message.params.request.url);
      socket.send(JSON.stringify({ id: ++sequence, method: "Fetch.failRequest", params: { requestId: message.params.requestId, errorReason: "ConnectionRefused" } }));
    }
    const handler = pending.get(message.id);
    if (handler) { clearTimeout(handler.timer); pending.delete(message.id); message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable");
  const login = await fetch("http://localhost:4001/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@pos.com", password: "admin123" }) });
  assert.equal(login.status, 200);
  const auth = (await login.json()).data;
  let checkoutTrackingToken;
  if (process.argv.includes("--checkout")) {
    const ordersResponse = await fetch("http://localhost:4001/api/orders?limit=100", { headers: { "x-cf-session-id": auth.session_id } });
    assert.equal(ordersResponse.status, 200);
    const orders = (await ordersResponse.json()).data;
    checkoutTrackingToken = orders.find((order) => order.channel === "qr" && order.tracking_token)?.tracking_token;
    assert.ok(checkoutTrackingToken, "An existing QR order is needed for the read-only checkout browser check");
  }
  await send("Network.setCookie", { name: "cf_session_id", value: auth.session_id, url: frontendOrigin, httpOnly: true, sameSite: "Lax" });
  const authScript = await send("Page.addScriptToEvaluateOnNewDocument", { source: `sessionStorage.setItem('cashflow-lite-tab-session-id',${JSON.stringify(auth.session_id)});` });
  await send("Page.navigate", { url: `${frontendOrigin}/qr-management` });
  let view;
  for (let attempt = 0; attempt < 60; attempt++) {
    await pause(500);
    view = await evaluate(`({route:location.pathname,images:[...document.querySelectorAll('[aria-label="Scannable table QR codes"] img')].map(image=>({alt:image.alt,ready:image.complete&&image.naturalWidth>0})),links:[...document.querySelectorAll('[aria-label="Scannable table QR codes"] a')].filter(link=>link.textContent==='Open menu').map(link=>link.href),text:(document.body?.innerText||'').slice(0,1500)})`);
    if (view.images.length && view.images.every((image) => image.ready)) break;
  }
  assert.ok(view.images.length, `No QR images rendered: ${view.text}`);
  assert.ok(view.images.every((image) => image.ready), "QR image failed to render");
  assert.ok(view.links.every((link) => !link.includes("192.168.1.67")), "Old network address is still shown");
  await mkdir("backend/logs", { recursive: true });
  await writeFile("backend/logs/qr-management-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
  console.log(JSON.stringify({ screen: "QR management", images: view.images, links: view.links }));
  if (process.argv.includes("--experience")) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Offers, feedback & analytics').click()`);
    let analytics;
    for (let attempt = 0; attempt < 90; attempt++) {
      await pause(500);
      analytics = await evaluate(`({visible:!!document.querySelector('[aria-label="QR service analytics"]'),text:document.body?.innerText||'',chart:!!document.querySelector('[aria-label="Daily QR orders and assistance requests"]')})`);
      if (analytics.visible && analytics.chart && analytics.text.includes("Recorded menu opens")) break;
    }
    assert.ok(analytics.visible && analytics.chart, `Service analytics did not load: ${analytics.text.slice(-900)}`);
    assert.ok(!analytics.text.includes("Could not load service analytics"));
    await writeFile("backend/logs/qr-service-analytics-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    console.log("Owner QR service analytics and feedback follow-up view render in Chrome");
  }
  if (process.argv.includes("--allergens")) {
    await send("Page.navigate", { url: `${frontendOrigin}/inventory` });
    let allergens;
    for (let attempt = 0; attempt < 90; attempt++) {
      await pause(500);
      allergens = await evaluate(`({visible:!!document.querySelector('[aria-label="Ingredient allergens"]'),text:document.body?.innerText||''})`);
      if (allergens.visible) break;
    }
    assert.ok(allergens.visible, `Ingredient allergen controls did not render: ${allergens.text.slice(-600)}`);
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent==='Manage ingredient allergens').click()`);
    for (let attempt = 0; attempt < 60; attempt++) {
      await pause(500);
      allergens = await evaluate(`({rows:document.querySelectorAll('[aria-label="Ingredient allergens"] tbody tr').length,text:document.querySelector('[aria-label="Ingredient allergens"]')?.innerText||''})`);
      if (allergens.rows) break;
    }
    assert.ok(allergens.rows > 0 && !allergens.text.includes("Unable to load"), "Ingredient allergen API did not populate the inventory panel");
    await writeFile("backend/logs/ingredient-allergens-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    console.log(`Ingredient allergen panel renders ${allergens.rows} actual ingredient rows in Chrome (no edits)`);
  }
  if (process.argv.includes("--central")) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `${frontendOrigin}/central-kitchen` });
    let kitchen;
    for (let attempt = 0; attempt < 90; attempt++) {
      await pause(500);
      kitchen = await evaluate(`({text:document.body?.innerText||'',outlets:document.querySelector('.cf-kitchen-list')?.innerText||'',overlay:!!document.querySelector('iframe#webpack-dev-server-client-overlay')})`);
      if (kitchen.text.includes("Below reorder level (") && kitchen.text.includes("Stock location: Central store")) break;
    }
    assert.ok(kitchen.text.includes("Below reorder level (") && !kitchen.overlay, "Central Kitchen did not load its repaired snapshot");
    assert.ok(!kitchen.outlets.includes("AdminCore Bridge Outlet"), "Inactive smoke outlets remain in the operational outlet list");
    assert.ok(!kitchen.text.includes("4.970000000000001"), "Raw floating-point quantities remain visible");
    await writeFile("backend/logs/central-kitchen-repaired.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    console.log("Central Kitchen renders ledger stock, active outlets, formatted quantities and explicit transfer states in Chrome");
  }
  if (process.argv.includes("--assistance")) {
    await send("Page.navigate", { url: `${frontendOrigin}/waiter` });
    let inbox;
    for (let attempt = 0; attempt < 90; attempt++) {
      await pause(500);
      inbox = await evaluate(`({visible:!!document.querySelector('[aria-label="Table service requests"]'),text:document.body?.innerText||''})`);
      if (inbox.visible && (inbox.text.includes("No active requests") || inbox.text.includes("Take request") || inbox.text.includes("Mark completed"))) break;
    }
    assert.ok(inbox.visible, `Staff assistance queue did not render: ${inbox.text.slice(0,600)}`);
    assert.ok(!inbox.text.includes("Backend unavailable") && !inbox.text.includes("Invalid table assistance response"), "Assistance inbox failed to parse its successful API response");
    await writeFile("backend/logs/table-assistance-staff-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    console.log("Waiter service-request queue renders in Chrome");
  }
  if (process.argv.includes("--customers")) {
    await send("Page.navigate", { url: `${frontendOrigin}/customers` });
    let customers;
    for (let attempt = 0; attempt < 60; attempt++) {
      await pause(500);
      customers = await evaluate(`({count:Number(document.querySelector('[data-testid="customers-page"] .cf-metric__value')?.textContent),hasGuest:document.body?.innerText.toLowerCase().includes('nani'),rows:document.querySelectorAll('[data-testid="customers-page"] tbody tr').length,route:location.pathname,text:(document.body?.innerText||'').slice(0,1200)})`);
      if (customers.count >= 2 && customers.hasGuest) break;
    }
    assert.ok(customers.count >= 2 && customers.hasGuest, `Imported QR guest must appear on Customers with the default filters: ${JSON.stringify(customers)}`);
    await writeFile("backend/logs/customers-sync-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    console.log(`Customers browser check: ${customers.count} profiles; existing QR guest visible with default filters`);
  }
  if (process.argv.includes("--staff-routes")) {
    for (const [route, title] of [["customers", "Customers"], ["manager", "Manager"], ["billing", "Billing"]]) {
      await send("Page.navigate", { url: `${frontendOrigin}/${route}` });
      let page;
      for (let attempt = 0; attempt < 90; attempt++) {
        await pause(500);
        page = await evaluate(`({text:document.body?.innerText||'',overlay:!!document.querySelector('iframe#webpack-dev-server-client-overlay'),route:location.pathname})`);
        if (page.text.includes(title) && !page.text.includes("Loading workspace")) break;
      }
      assert.equal(page.route, `/${route}`);
      assert.ok(page.text.includes(title) && !page.overlay && !page.text.includes("Cannot read properties of undefined"), `${route} has a runtime error: ${page.text.slice(-900)}`);
      console.log(`Staff route ${frontendOrigin}/${route} renders without a runtime overlay`);
    }
  }
  if (process.argv.includes("--reports")) {
    for (const route of ["dashboard", "reports"]) {
      await send("Page.navigate", { url: `${frontendOrigin}/${route}` });
      let reportPage;
      for (let attempt = 0; attempt < 90; attempt++) {
        await pause(500);
        reportPage = await evaluate(`({charts:!!document.querySelector('[aria-label="Sales explained"]'),text:document.body?.innerText||'',overlay:!!document.querySelector('iframe#webpack-dev-server-client-overlay')})`);
        if (reportPage.charts) break;
      }
      assert.ok(reportPage.charts && !reportPage.overlay && !reportPage.text.includes("Request failed"), `${route} charts did not load: ${reportPage.text.slice(-900)}`);
      if (route === "dashboard") assert.ok(reportPage.text.includes("How customers order"), "Dashboard service-share chart or truthful empty state is missing");
      await writeFile(`backend/logs/${route}-sales-verified.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    }
    console.log("Dashboard service-share chart and scoped report charts load from the real backend without a runtime overlay");
  }
  // Leave the staff document before clearing its credentials. Otherwise a still
  // running staff request can receive 401 and start its own refresh while the
  // test is preparing the camera-opened guest scenario.
  await send("Page.navigate", { url: `${frontendOrigin}${new URL(view.links[0]).pathname}` });
  for (let attempt = 0; attempt < 60; attempt++) {
    await pause(300);
    if (await evaluate(`Boolean(document.querySelector('.cf-qr-menu-item'))`)) break;
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: authScript.identifier });
  await send("Network.clearBrowserCookies");
  await evaluate("sessionStorage.clear(); localStorage.clear();");
  // Reproduce a camera-opened menu: no login cookie, and staff auth is unreachable.
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Page.navigate", { url: view.links[0] });
  let menu;
  for (let attempt = 0; attempt < 60; attempt++) {
    await pause(500);
    menu = await evaluate(`({title:document.title,text:document.body?.innerText||'',items:document.querySelectorAll('.cf-qr-menu-card').length})`);
    if (!menu.text.includes("Loading") && menu.text.includes("Add")) break;
  }
  assert.ok(menu.text.includes("Add"), `Menu did not load: ${menu.text.slice(0,800)}`);
  assert.ok(!menu.text.includes("Ordering unavailable"));
  assert.ok(!menu.text.includes("Your saved session has been kept"));
  if (process.argv.includes("--assistance")) for (const label of ["Call waiter", "Table assistance", "Request bill"]) assert.ok(menu.text.includes(label), `Phone menu is missing ${label}`);
  if (process.argv.includes("--food")) {
    for (const label of ["Food preference", "Have an allergy?"]) assert.ok(menu.text.includes(label), `Phone menu is missing ${label}`);
    assert.ok(await evaluate(`!document.querySelector('.cf-qr-menu-item input, .cf-qr-menu-item textarea, .cf-qr-menu-item select')`), "Browsing cards must not contain customisation forms");
    await evaluate(`[...document.querySelectorAll('.cf-qr-menu-item button')].find(button=>button.textContent==='Add'&&!button.disabled).click()`);
    await pause(300);
    const sheet = await evaluate(`({visible:!!document.querySelector('[role="dialog"]'),text:document.querySelector('[role="dialog"]')?.innerText||'',overflow:document.documentElement.scrollWidth>innerWidth})`);
    assert.ok(sheet.visible && sheet.text.includes("Allergens & food information") && sheet.text.includes("Add a kitchen request"), "Item detail sheet is missing optional disclosures");
    assert.equal(sheet.overflow, false, "Item sheet must fit the mobile screen");
    await writeFile("backend/logs/qr-item-sheet-phone-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    await evaluate(`document.querySelector('[aria-label="Close item details"]').click()`);
    console.log("Mobile menu has clean browsing cards; customisation and optional disclosures open in an item sheet");
  }
  assert.deepEqual(unexpectedAuthRequests, [], "Public QR menu must not request staff authentication");
  if (process.argv.includes("--checkout")) {
    await send("Page.navigate", { url: `${new URL(view.links[0]).origin}/qr/orders/${checkoutTrackingToken}` });
    let checkout;
    for (let attempt = 0; attempt < 60; attempt++) {
      await pause(500);
      checkout = await evaluate(`({visible:!!document.querySelector('[aria-label="Bill, split payments and loyalty"]'),text:document.body?.innerText||''})`);
      if (checkout.visible && !checkout.text.includes("Loading bill...")) break;
    }
    assert.ok(checkout.visible && checkout.text.includes("Your bill & payment"), "Guest checkout did not render");
    assert.ok(!checkout.text.includes("Could not refresh your bill"), "Guest bill endpoint failed in the phone browser");
    if (process.argv.includes("--experience")) {
      let feedback;
      for (let attempt = 0; attempt < 60; attempt++) {
        feedback = await evaluate(`({visible:!!document.querySelector('[aria-label="Guest feedback"]'),text:document.body?.innerText||''})`);
        if (feedback.visible && !feedback.text.includes("Loading feedback...")) break;
        await pause(500);
      }
      assert.ok(feedback.visible && !feedback.text.includes("Feedback could not be loaded"), "Guest feedback did not load");
      console.log("Signed-out mobile guest feedback loads without staff authentication");
    }
    assert.deepEqual(unexpectedAuthRequests, [], "Guest checkout must not request staff authentication");
    await writeFile("backend/logs/qr-checkout-phone-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data, "base64"));
    console.log("Signed-out mobile QR tracking and bill/loyalty checkout render with staff auth blocked");
  }
  await writeFile("backend/logs/qr-menu-phone-verified.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  console.log("Real Chrome: QR image renders; signed-out phone menu loads with staff auth blocked and zero auth requests");
} finally {
  for (const handler of pending.values()) clearTimeout(handler.timer);
  socket?.close();
  chrome.kill();
}
