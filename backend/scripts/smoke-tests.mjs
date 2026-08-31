import http from "http";

import app from "../src/app.js";
import prisma from "../src/database/prisma/client.js";
import { outletsService } from "../src/core/outlets/outlets.service.js";
import { calculateInvoiceTotals } from "../src/core/billing/billing-depth.utils.js";

const server = http.createServer(app);

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
    await request({ baseUrl, path: "/health" });
    await request({ baseUrl, path: "/health/database", expected: [200, 503] });
    await request({ baseUrl, path: "/health/jobs" });
    await request({ baseUrl, path: "/api/admincore/connection" });

    const login = await request({
      baseUrl,
      path: "/api/auth/login",
      method: "POST",
      body: {
        email: process.env.SMOKE_OWNER_EMAIL || process.env.ADMIN_EMAIL || "owner@pos.com",
        password: process.env.SMOKE_OWNER_PASSWORD || process.env.ADMIN_PASSWORD || "admin123",
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
    const fallbackTenantId = "smoke-outlet-tenant";
    const fallbackBusinessId = "smoke-outlet-business";
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

    if (process.env.ADMINCORE_API_KEY) {
      const bridgeHeaders = {
        "x-admincore-api-key": process.env.ADMINCORE_API_KEY,
      };
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
        "/api/sync/export/reservations?limit=5",
        "/api/sync/export/kot?limit=5",
      ];

      for (const path of apiKeyOnlyChecks) {
        await request({ baseUrl, path, headers: bridgeHeaders });
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
          business_id: process.env.DEFAULT_BUSINESS_ID || "demo-business",
          tenant_id: process.env.DEFAULT_TENANT_ID || "demo-tenant",
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
          "x-tenant-id": process.env.DEFAULT_TENANT_ID || "demo-tenant",
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
          business_id: process.env.DEFAULT_BUSINESS_ID || "demo-business",
          tenant_id: process.env.DEFAULT_TENANT_ID || "demo-tenant",
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
          "x-tenant-id": process.env.DEFAULT_TENANT_ID || "demo-tenant",
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
    await close();
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
