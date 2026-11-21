import http from "http";
import { randomUUID } from "node:crypto";

import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import env from "../src/config/env.js";
import { outletsService } from "../src/core/outlets/outlets.service.js";
import { calculateInvoiceTotals } from "../src/core/billing/billing-depth.utils.js";
import { usersService } from "../src/core/users/users.service.js";
import { saasService } from "../src/core/saas/saas.service.js";
import { connectDatabase } from "../src/config/db.js";
import { admincoreChangeSyncService } from "../src/core/admincore/admincore-change-sync.service.js";
import { stopRealtime } from "../src/services/realtime/realtime.service.js";

const server = http.createServer(app);
const fixtureId = randomUUID(), fixtureBusiness = `smoke-${fixtureId}`, fixtureTenant = `tenant-${fixtureId}`;
const fallbackBusinessId = `smoke-fallback-${fixtureId}`, fallbackTenantId = `tenant-fallback-${fixtureId}`;
const fixtureEmail = `smoke-${fixtureId}@example.invalid`, fixturePassword = randomUUID();
const originalConfigured = admincoreChangeSyncService.isConfigured;

const listen = () =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });

const close = () =>
  new Promise((resolve) => {
    server.close(() => resolve());
  });

const request = async ({ baseUrl, path, method = "GET", body, cookie, headers = {}, expected = [200] }) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${text}`);
  }

  return { response, data };
};

const extractCookie = (response) => {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Login did not return a session cookie");
  }
  return setCookie.split(";")[0];
};

const assertAdminCoreEnvelope = (data, resource) => {
  if (!data?.success || data.resource !== resource || !Array.isArray(data.items) || !data.meta) {
    throw new Error(`AdminCore sync envelope failed for ${resource}: ${JSON.stringify(data)}`);
  }
};

const assertCalculationGuards = () => {
  const totals = calculateInvoiceTotals(
    {
      subtotal: 9999,
      tax: 9999,
      total: 9999,
      discount_type: "percent",
      discount_value: 10,
      gst_rate: 18,
    },
    [
      { quantity: 2, price: 100 },
      { quantity: 1, price: 50 },
    ],
  );

  if (totals.subtotal !== 250 || totals.discount_amount !== 25 || totals.tax !== 40.5 || totals.total !== 265.5) {
    throw new Error(`Invoice calculation guard failed: ${JSON.stringify(totals)}`);
  }
};

const run = async () => {
  assertCalculationGuards();
  const address = await listen();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    await connectDatabase();
    // Bridge handlers remain enabled, but fixtures must never notify the real AdminCore.
    admincoreChangeSyncService.isConfigured = () => false;
    await prisma.business.create({ data: { id: fixtureBusiness, tenantId: fixtureTenant, name: "Isolated smoke fixture" } });
    await saasService.updateSubscription({ businessId: fixtureBusiness, payload: { plan: "growth", subscription_status: "active" } });
    await usersService.createUser({ businessId: fixtureBusiness, tenantId: fixtureTenant, payload: { name: "Smoke owner", email: fixtureEmail, password: fixturePassword, role: "Owner", profile_required: false } });
    await request({ baseUrl, path: "/health" });
    await request({ baseUrl, path: "/health/database", expected: [200, 503] });
    await request({ baseUrl, path: "/health/jobs" });
    await request({ baseUrl, path: "/api/admincore/connection" });

    const login = await request({
      baseUrl,
      path: "/api/auth/login",
      method: "POST",
      body: {
        email: fixtureEmail,
        password: fixturePassword,
        business_id: fixtureBusiness,
      },
    });
    const cookie = extractCookie(login.response);

    await request({ baseUrl, path: "/api/auth/session", cookie });
    await request({ baseUrl, path: "/api/businesses", cookie });
    await request({ baseUrl, path: "/api/products?limit=5", cookie });
    await request({ baseUrl, path: "/api/orders?limit=5", cookie });
    await request({ baseUrl, path: "/api/billing?limit=5", cookie });
    await request({ baseUrl, path: "/api/customers?limit=5", cookie });
    await request({ baseUrl, path: "/api/payments?limit=5", cookie });
    await request({ baseUrl, path: "/api/inventory?limit=5", cookie });
    const outlets = await request({ baseUrl, path: "/api/outlets", cookie });
    if (!Array.isArray(outlets.data) || outlets.data.length < 1) {
      throw new Error(`/api/outlets must return at least one outlet for a valid business: ${JSON.stringify(outlets.data)}`);
    }
    const fallbackOutlets = await outletsService.listOutlets({
      tenantId: fallbackTenantId,
      businessId: fallbackBusinessId,
    });
    const repeatedFallbackOutlets = await outletsService.listOutlets({
      tenantId: fallbackTenantId,
      businessId: fallbackBusinessId,
    });
    const fallbackMainOutlets = repeatedFallbackOutlets.filter((outlet) => outlet.name === "Main Outlet");
    if (fallbackOutlets.length < 1 || fallbackMainOutlets.length !== 1) {
      throw new Error(
        `Outlet fallback must create exactly one Main Outlet: ${JSON.stringify(repeatedFallbackOutlets)}`,
      );
    }
    await request({ baseUrl, path: "/api/staff", cookie });
    await request({ baseUrl, path: "/api/tables", cookie });
    await request({ baseUrl, path: "/api/reservations?include_history=true", cookie });
    const dashboardStats = await request({ baseUrl, path: "/api/dashboard/stats?period=all", cookie });
    if (!dashboardStats.data?.revenue_detail || dashboardStats.data.total_revenue !== dashboardStats.data.revenue_detail.revenue) {
      throw new Error(`Dashboard revenue detail must match dashboard card revenue: ${JSON.stringify(dashboardStats.data?.revenue_detail)}`);
    }
    await request({ baseUrl, path: "/api/reports/gst", cookie });
    // Exercise the actual dashboard endpoint, not only the pure report rule.
    const emptyClosed = `empty-${fixtureId}`, historicalClosed = `closed-${fixtureId}`;
    await prisma.outlet.createMany({ data: [
      { id: emptyClosed, businessId: fixtureBusiness, name: 'Empty closed fixture', code: 'EMPTY', status: 'inactive' },
      { id: historicalClosed, businessId: fixtureBusiness, name: 'Historical closed fixture', code: 'HISTORY', status: 'inactive' },
    ] });
    await prisma.bill.create({ data: { businessId: fixtureBusiness, customerName: 'Isolated fixture', subtotal: 7, total: 7, currency: 'INR', status: 'paid', metadata: { outlet_id: historicalClosed } } });
    const outletRanking = (await request({ baseUrl, path: '/api/dashboard/stats?period=all', cookie })).data.sales_by_outlet;
    if (outletRanking.some(row => row.outlet_id === emptyClosed) || !outletRanking.some(row => row.outlet_id === historicalClosed && row.sales === 7)) {
      throw new Error('Dashboard must omit empty closed outlets and retain closed-outlet sales');
    }
    const scopedRanking = (await request({ baseUrl, path: `/api/dashboard/stats?period=all&outlet_id=${historicalClosed}`, cookie })).data.sales_by_outlet;
    if (scopedRanking.length !== 1 || scopedRanking[0].outlet_id !== historicalClosed || scopedRanking[0].sales !== 7) {
      throw new Error('Dashboard outlet ranking ignored the selected outlet');
    }
    await request({ baseUrl, path: "/api/sync/strategy", cookie });

    for (const resource of [
      "businesses",
      "outlets",
      "products",
      "orders",
      "bills",
      "customers",
      "payments",
      "staff",
      "inventory",
      "tables",
      "reservations",
      "kot",
    ]) {
      const syncExport = await request({
        baseUrl,
        path: `/api/sync/export/${resource}?limit=5`,
        cookie,
      });
      assertAdminCoreEnvelope(syncExport.data, resource);

      const directResourcePaths = {
        bills: "billing",
      };
      const directResource = directResourcePaths[resource] || resource;
      const syncList = await request({
        baseUrl,
        path: ["tables", "reservations", "kot"].includes(resource)
          ? `/api/${directResource}?sync=admincore`
          : `/api/${directResource}?sync=admincore&limit=5`,
        cookie,
      });
      assertAdminCoreEnvelope(syncList.data, resource);
    }

    for (const resource of [
      "qr",
      "central-kitchen",
      "taxes",
      "discounts",
      "suppliers",
      "expenses",
      "hardware",
      "permissions",
      "notifications",
      "import-export",
      "webhooks",
      "audit-security",
      "settings",
    ]) {
      const syncExport = await request({
        baseUrl,
        path: `/api/sync/export/${resource}?limit=5`,
        cookie,
      });
      assertAdminCoreEnvelope(syncExport.data, resource);
    }

    await request({ baseUrl, path: "/api/sync/logs/admincore", cookie });
    const failedSync = await request({
      baseUrl,
      path: "/api/sync/export/not-real",
      cookie,
      expected: [400],
    });
    if (failedSync.data?.success !== false || !Array.isArray(failedSync.data?.items)) {
      throw new Error(`AdminCore sync error envelope failed: ${JSON.stringify(failedSync.data)}`);
    }

    if (env.admincore.enabled && env.admincore.apiKey) {
      const bridgeHeaders = {
        "x-admincore-api-key": process.env.ADMINCORE_API_KEY,
        "x-business-id": fixtureBusiness,
        "x-tenant-id": fixtureTenant,
      };
      await request({ baseUrl, path: "/api/sync/export/products", headers: {
        "x-admincore-api-key": process.env.ADMINCORE_API_KEY,
      }, expected: [400] });
      await request({ baseUrl, path: "/api/sync/export/products", headers: {
        ...bridgeHeaders, "x-tenant-id": "unrelated-tenant",
      }, expected: [403] });
      const apiKeyOnlyChecks = [
        "/api/sync/export/businesses?limit=5",
        "/api/sync/export/outlets?limit=5",
        "/api/sync/export/products?limit=5",
        "/api/sync/export/orders?limit=5",
        "/api/sync/export/bills?limit=5",
        "/api/sync/export/customers?limit=5",
        "/api/sync/export/payments?limit=5",
        "/api/sync/export/reports?limit=5",
        "/api/sync/export/staff?limit=5",
        "/api/sync/export/inventory?limit=5",
        "/api/sync/export/tables?limit=5",
        "/api/sync/export/qr?limit=5",
        "/api/sync/export/reservations?limit=5",
        "/api/sync/export/kot?limit=5",
        "/api/sync/export/central-kitchen?limit=5",
        "/api/sync/export/taxes?limit=5",
        "/api/sync/export/discounts?limit=5",
        "/api/sync/export/suppliers?limit=5",
        "/api/sync/export/expenses?limit=5",
        "/api/sync/export/hardware?limit=5",
        "/api/sync/export/permissions?limit=5",
        "/api/sync/export/notifications?limit=5",
        "/api/sync/export/import-export?limit=5",
        "/api/sync/export/webhooks?limit=5",
        "/api/sync/export/audit-security?limit=5",
        "/api/sync/export/settings?limit=5",
      ];

      for (const path of apiKeyOnlyChecks) {
        await request({ baseUrl, path, headers: bridgeHeaders });
      }
      for (const resource of ["products", "outlets", "staff"]) {
        await request({ baseUrl, path: `/api/admincore/${resource}`, method: "POST",
          headers: bridgeHeaders, body: {
            business_id: "unrelated-business", tenant_id: bridgeHeaders["x-tenant-id"], name: "Must not be created",
          }, expected: [400] });
        await request({ baseUrl, path: `/api/admincore/${resource}`, method: "POST",
          headers: { ...bridgeHeaders, "x-business-id": "unrelated-business" }, body: {
            business_id: "unrelated-business", tenant_id: bridgeHeaders["x-tenant-id"], name: "Must not be created",
          }, expected: [403] });
      }

      const bridgeOutlet = await request({
        baseUrl,
        path: "/api/admincore/outlets",
        method: "POST",
        headers: bridgeHeaders,
        body: {
          name: `AdminCore Bridge Outlet ${Date.now()}`,
          code: `SMK${String(Date.now()).slice(-6)}`,
          status: "active",
          business_id: fixtureBusiness,
          tenant_id: fixtureTenant,
        },
        expected: [201],
      });
      const bridgeOutletId = bridgeOutlet.data?.id || bridgeOutlet.data?.data?.id;
      if (!bridgeOutletId) {
        throw new Error(`AdminCore outlet bridge did not return an outlet id: ${JSON.stringify(bridgeOutlet.data)}`);
      }
      await request({
        baseUrl,
        path: `/api/admincore/outlets/${bridgeOutletId}`,
        method: "DELETE",
        headers: {
          ...bridgeHeaders,
          "x-tenant-id": fixtureTenant,
        },
      });

      const bridgeProduct = await request({
        baseUrl,
        path: "/api/admincore/products",
        method: "POST",
        headers: bridgeHeaders,
        body: {
          name: `AdminCore Bridge Smoke ${Date.now()}`,
          price: 1,
          stock: 1,
          category: "Smoke",
          business_id: fixtureBusiness,
          tenant_id: fixtureTenant,
        },
        expected: [201],
      });
      const bridgeProductId = bridgeProduct.data?.id || bridgeProduct.data?.data?.id;
      if (!bridgeProductId) {
        throw new Error(`AdminCore product bridge did not return a product id: ${JSON.stringify(bridgeProduct.data)}`);
      }
      await request({
        baseUrl,
        path: `/api/admincore/products/${bridgeProductId}`,
        method: "DELETE",
        headers: {
          ...bridgeHeaders,
          "x-tenant-id": fixtureTenant,
        },
      });

      await request({
        baseUrl,
        path: "/api/products?limit=5",
        headers: bridgeHeaders,
        expected: [401],
      });
    }

    await request({ baseUrl, path: "/api/products?limit=5", cookie });
    await request({ baseUrl, path: "/api/inventory?limit=5", cookie });

    await request({
      baseUrl,
      path: "/api/printer",
      method: "POST",
      cookie,
      body: {
        type: "smoke-test",
        target: "virtual-printer",
        copies: 1,
        auto_print: false,
        payload: { text: "Smoke test print payload" },
      },
      expected: [202],
    });

    console.log("Smoke tests passed");
  } finally {
    admincoreChangeSyncService.isConfigured = originalConfigured;
    await close();
    const ids = [fixtureBusiness, fallbackBusinessId];
    const users = await prisma.user.findMany({ where: { businessId: { in: ids } }, select: { id: true } });
    await prisma.authSession.deleteMany({ where: { userId: { in: users.map((row) => row.id) } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
    for (const businessId of ids) {
      await prisma.stateDocument.deleteMany({ where: { OR: [{ key: { contains: businessId } }, { data: { path: ["business_id"], equals: businessId } }] } });
      await prisma.backgroundJob.deleteMany({ where: { payload: { path: ["business_id"], equals: businessId } } });
    }
    await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId: { in: [fixtureTenant, fallbackTenantId] } } });
    await stopRealtime();
    await prisma.$disconnect();
  }
};

run().catch(async (error) => {
  console.error(error);
  try {
    await close();
    await prisma.$disconnect();
  } finally {
    process.exit(1);
  }
});
