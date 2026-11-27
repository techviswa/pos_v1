// QR Studio: printed design rules (scan safety), smart codes (permanent token, editable destination, scan log,
// outlet scope, plan gate), guest-menu branding per outlet, and per-code performance from real scans and orders.
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { connectDatabase } from "../src/config/db.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { usersService } from "../src/core/users/users.service.js";
import { validateDesign, contrastRatio } from "../src/features/sales-extensions/qr-studio/qr-design.js";
import { videoEmbedUrl } from "../src/features/sales-extensions/qr-studio/qr-brand.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const suffix = randomUUID().slice(0, 8), rich = `qs-ent-${suffix}`, basic = `qs-start-${suffix}`, password = randomUUID();
const api = http.createServer(app);
const PNG = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64")}`;
let base, checks = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const throwsCode = (fn, pattern) => { assert.throws(fn, (error) => pattern.test(error.message)); checks++; };
const call = async (method, path, body, session) => {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(session ? { "x-cf-session-id": session } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json().catch(() => null);
  return { status: response.status, data: json?.data ?? json, message: json?.message || json?.error?.message };
};
try {
  await connectDatabase();
  // Design rules: dark on light, contrast at least 4.5:1, small logo.
  throwsCode(() => validateDesign({ fg: "#ffffff", bg: "#111111" }), /dark code on a light background/);
  throwsCode(() => validateDesign({ fg: "#9ca3af", bg: "#ffffff" }), /too close/);
  throwsCode(() => validateDesign({ logo_scale: 0.4 }), /between 12% and 24%/);
  throwsCode(() => validateDesign({ modules: "hearts" }), /Choose one of/);
  eq(validateDesign({ fg: "#7C2D12", bg: "#FFF7ED", modules: "dots", eyes: "circle", logo: PNG, logo_scale: 0.22 }).fg, "#7c2d12");
  eq(contrastRatio("#000000", "#ffffff") > 20, true);
  // Video links become players; anything else is refused.
  eq(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  eq(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ?t=3"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  eq(videoEmbedUrl("https://youtube.com/shorts/abcDEF12345"), "https://www.youtube-nocookie.com/embed/abcDEF12345");
  eq(videoEmbedUrl("https://vimeo.com/123456789"), "https://player.vimeo.com/video/123456789");
  eq([videoEmbedUrl("http://youtu.be/dQw4w9WgXcQ"), videoEmbedUrl("https://evil.test/watch?v=x"), videoEmbedUrl("javascript:alert(1)")], [null, null, null]);

  for (const [id, plan] of [[rich, "enterprise"], [basic, "starter"]]) {
    await prisma.business.create({ data: { id, tenantId: `tenant-${id}`, name: `QR fixture ${plan}` } });
    await saasService.updateSubscription({ businessId: id, payload: { plan, subscription_status: "active" } });
  }
  const [main, second] = await Promise.all(["Main", "Second"].map((name, index) => prisma.outlet.create({ data: { businessId: rich, name, code: `Q${index}${suffix}` } })));
  await prisma.tableManagementSettings.create({ data: { businessId: rich, capabilities: { qrOrderingEnabled: true } } });
  const [latte, cake] = await Promise.all([["Latte", "Coffee", 150], ["Cake", "Dessert", 200]].map(([name, category, price]) => prisma.product.create({ data: { businessId: rich, name, category, price, stock: 20 } })));
  const rule = await prisma.priceRule.create({ data: { businessId: rich, name: "Coffee hour", discountType: "percent_off", value: 10, daysOfWeek: [], startMinute: 0, endMinute: 0, channels: [], outletIds: [], productIds: [], categories: ["Coffee"] } });
  const offRule = await prisma.priceRule.create({ data: { businessId: rich, name: "Old deal", active: false, discountType: "amount_off", value: 5, daysOfWeek: [], startMinute: 0, endMinute: 0, channels: [], outletIds: [], productIds: [], categories: [] } });
  const table = await prisma.diningTable.create({ data: { businessId: rich, name: "T1", meta: { outlet_id: main.id } } });
  const tableCode = await prisma.tableQrCode.create({ data: { businessId: rich, tableId: table.id, token: `tq-${suffix}` } });

  const mk = (businessId, role, extra = {}) => usersService.createUser({ businessId, tenantId: `tenant-${businessId}`, payload: { email: `${role}-${businessId}-${randomUUID().slice(0, 4)}@t.test`, password, role, name: role, profile_required: false, ...extra } });
  const [owner, restricted, cashier, basicOwner] = await Promise.all([mk(rich, "Owner"), mk(rich, "Cashier", { permissions: ["qr_management", "reports"], assigned_outlet_ids: [second.id] }), mk(rich, "Cashier", { permissions: ["billing"] }), mk(basic, "Owner")]);
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${api.address().port}`;
  const login = async (user) => (await call("POST", "/api/auth/login", { email: user.email, password })).data.session_id;
  const [ownerS, restrictedS, cashierS, basicS] = await Promise.all([owner, restricted, cashier, basicOwner].map(login));

  // Printed design: every plan with tables; saved per business; refused when unsafe.
  eq((await call("GET", "/api/table-management/qr-design", null, basicS)).data.saved, false);
  eq((await call("PUT", "/api/table-management/qr-design", { fg: "#eeeeee", bg: "#ffffff" }, basicS)).status, 400);
  const savedDesign = await call("PUT", "/api/table-management/qr-design", { fg: "#1e3a8a", modules: "rounded", cta: "Scan to order", logo: PNG }, basicS);
  eq([savedDesign.status, savedDesign.data.saved, savedDesign.data.modules, savedDesign.data.logo?.startsWith("data:image/png")], [200, true, "rounded", true]);
  eq((await call("GET", "/api/table-management/qr-design", null, ownerS)).data.saved, false, "designs are per business");
  eq((await call("PUT", "/api/table-management/qr-design", { fg: "#000000" }, cashierS)).status, 403);

  // Smart codes are a plan feature.
  eq((await call("GET", "/api/qr-studio/links", null, basicS)).status, 403, "Starter has no smart codes");
  eq((await call("GET", "/api/qr-studio/links", null, cashierS)).status, 403, "needs the QR & tables screen");
  eq((await call("POST", "/api/qr-studio/links", { name: "Menu", kind: "menu", config: {} }, ownerS)).status, 400, "two open outlets: choose one");
  eq((await call("POST", "/api/qr-studio/links", { name: "Offer", kind: "offer", config: { outlet_id: main.id, rule_id: offRule.id } }, ownerS)).status, 400, "switched-off offers cannot be printed");
  eq((await call("POST", "/api/qr-studio/links", { name: "Site", kind: "link", config: { url: "http://insecure.test" } }, ownerS)).status, 400);
  eq((await call("POST", "/api/qr-studio/links", { name: "Card", kind: "card", config: { title: "Bheemas" } }, ownerS)).status, 400, "a card needs a way to reach you");
  const menuLink = (await call("POST", "/api/qr-studio/links", { name: "Counter menu", kind: "menu", config: { outlet_id: main.id, headline: "Order at the counter" } }, ownerS)).data;
  const offerLink = (await call("POST", "/api/qr-studio/links", { name: "Coffee poster", kind: "offer", config: { outlet_id: main.id, rule_id: rule.id } }, ownerS)).data;
  const reviewLink = (await call("POST", "/api/qr-studio/links", { name: "Google review", kind: "review", config: { url: "https://g.page/r/example/review" } }, ownerS)).data;
  const cardLink = (await call("POST", "/api/qr-studio/links", { name: "Owner card", kind: "card", config: { title: "Asha", phone: "+91 98765 43210", instagram: "@bheemas" } }, ownerS)).data;
  eq([menuLink.token.length, offerLink.kind, cardLink.config.instagram], [12, "offer", "bheemas"]);
  eq((await call("POST", "/api/qr-studio/links", { name: "Other outlet", kind: "menu", config: { outlet_id: main.id } }, restrictedS)).status, 403, "outlet staff stay in their outlet");
  const secondLink = await call("POST", "/api/qr-studio/links", { name: "Second menu", kind: "menu", config: { outlet_id: second.id } }, restrictedS);
  eq(secondLink.status, 201);
  eq((await call("GET", "/api/qr-studio/links", null, restrictedS)).data.map((link) => link.name), ["Second menu"]);
  eq((await call("PUT", `/api/qr-studio/links/${menuLink.id}`, { active: false }, restrictedS)).status, 404);

  // Guests: what each code opens; every open is logged.
  const opened = await call("GET", `/api/public/qr-studio/links/${menuLink.token}`);
  eq([opened.status, opened.data.kind, opened.data.headline, opened.data.items.map((item) => item.name).sort()], [200, "menu", "Order at the counter", ["Cake", "Latte"]]);
  const offer = (await call("GET", `/api/public/qr-studio/links/${offerLink.token}`)).data;
  eq([offer.offer.deal, offer.offer.hours, offer.offer.active_now, offer.items.map((item) => [item.name, item.price])], ["10% off", "All day", true, [["Latte", 135]]]);
  eq((await call("GET", `/api/public/qr-studio/links/${reviewLink.token}`)).data.url, "https://g.page/r/example/review");
  eq((await call("GET", `/api/public/qr-studio/links/${cardLink.token}`)).data.card.phone, "+91 98765 43210");
  await call("GET", `/api/public/qr-studio/links/${menuLink.token}?refresh=1`);
  eq((await prisma.qrLink.findUnique({ where: { id: menuLink.id } })).scanCount, 1, "refreshing the page is not a new scan");
  // Changing where a code leads keeps its token, so printed codes keep working.
  const moved = await call("PUT", `/api/qr-studio/links/${reviewLink.id}`, { config: { url: "https://example.com/reviews" } }, ownerS);
  eq([moved.data.token, (await call("GET", `/api/public/qr-studio/links/${reviewLink.token}`)).data.url], [reviewLink.token, "https://example.com/reviews"]);
  await call("PUT", `/api/qr-studio/links/${cardLink.id}`, { active: false }, ownerS);
  eq((await call("GET", `/api/public/qr-studio/links/${cardLink.token}`)).status, 404, "switched-off codes stop working");
  eq((await call("GET", "/api/public/qr-studio/links/not-a-token")).status, 404);

  // Branding per outlet appears on the table menu and on smart codes of that outlet.
  eq((await call("PUT", "/api/qr-studio/brand?outlet_id=" + main.id, { accent: "#b45309", featured: ["nope"] }, ownerS)).status, 400);
  eq((await call("PUT", "/api/qr-studio/brand?outlet_id=" + main.id, { videos: [{ url: "https://evil.test/v" }] }, ownerS)).status, 400);
  const brand = await call("PUT", "/api/qr-studio/brand?outlet_id=" + main.id, { accent: "#B45309", welcome: "Fresh from our kitchen", logo: PNG, featured: [cake.id], videos: [{ title: "Meet the chef", url: "https://youtu.be/dQw4w9WgXcQ" }] }, ownerS);
  eq([brand.status, brand.data.accent, brand.data.videos[0].embed_url], [200, "#b45309", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]);
  eq((await call("GET", "/api/qr-studio/brand?outlet_id=" + main.id, null, restrictedS)).status, 403);
  const tableMenu = (await call("GET", `/api/public/qr/${tableCode.token}/menu`)).data;
  eq([tableMenu.brand.welcome, tableMenu.brand.featured_ids, tableMenu.brand.cover_url, Boolean(tableMenu.brand.logo_url)], ["Fresh from our kitchen", [cake.id], null, true]);
  const logo = await fetch(base + tableMenu.brand.logo_url);
  eq([logo.status, logo.headers.get("content-type")], [200, "image/png"]);
  eq((await call("GET", `/api/public/qr-studio/links/${menuLink.token}`)).data.brand.accent, "#b45309");

  // Performance: scans per table code, approved orders and their value, smart-code scans and devices.
  await call("GET", `/api/public/qr/${tableCode.token}/menu`);
  const order = { businessId: rich, outletId: main.id, customerName: "Guest", channel: "qr", total: 300, metadata: { table_id: table.id, approval_status: "approved" } };
  await prisma.order.createMany({ data: [{ ...order, status: "accepted" }, { ...order, status: "qr_rejected", metadata: { table_id: table.id, approval_status: "rejected" } }] });
  const insights = await call("GET", "/api/qr-studio/insights", null, ownerS);
  eq(insights.status, 200);
  eq([insights.data.tables[0].scans, insights.data.tables[0].orders, insights.data.tables[0].order_value, insights.data.tables[0].conversion_percent], [2, 1, 300, 50]);
  const byName = Object.fromEntries(insights.data.links.map((row) => [row.name, row]));
  eq([byName["Counter menu"].scans, byName["Google review"].scans], [2, 2]);
  eq(insights.data.hours.reduce((sum, row) => sum + row.scans, 0), insights.data.totals.table_scans + insights.data.totals.smart_code_scans);
  const scoped = await call("GET", "/api/qr-studio/insights", null, restrictedS);
  eq([scoped.data.tables.length, scoped.data.links.map((row) => row.name)], [0, ["Second menu"]], "outlet staff see their outlet only");
  eq((await call("GET", "/api/qr-studio/insights?outlet_id=" + main.id, null, restrictedS)).status, 403);

  // A business that drops to Starter: smart codes and branding stop showing, table ordering keeps working.
  await saasService.updateSubscription({ businessId: rich, payload: { plan: "starter", subscription_status: "active" } });
  eq((await call("GET", `/api/public/qr-studio/links/${menuLink.token}`)).status, 404);
  const plainMenu = await call("GET", `/api/public/qr/${tableCode.token}/menu`);
  eq([plainMenu.status, plainMenu.data.brand], [200, null]);
  console.log(`QR Studio passed (${checks} checks): scan-safe designs, smart codes with editable destinations and scan log, offers, contact cards, outlet scope, branding on guest menus, per-code performance, plan gate.`);
} finally {
  if (api.listening) await new Promise((resolve) => api.close(resolve));
  const users = await prisma.user.findMany({ where: { businessId: { in: [rich, basic] } }, select: { id: true } });
  await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } }).catch(() => {});
  await prisma.stateDocument.deleteMany({ where: { key: { contains: suffix } } }).catch(() => {});
  await prisma.business.deleteMany({ where: { id: { in: [rich, basic] } } }).catch(() => {});
  await stopRealtime(); await prisma.$disconnect();
}
process.exit(0);
