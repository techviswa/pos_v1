import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const adminBackend = process.argv[2];
if (!adminBackend) throw new Error("Pass the AdminCore backend directory");
const prefix = `cross-test-${randomUUID()}`;
process.env.ADMINCORE_ENABLED = "true";
process.env.ADMINCORE_API_KEY = "local-cross-project-test-key";
process.env.ADMINCORE_API_BASE_URL = "http://127.0.0.1:1";
const { default: app } = await import("../src/app.js");
const { default: prisma } = await import("../src/database/prisma/client.js");
const { connectDatabase } = await import("../src/config/db.js");
const server = http.createServer(app);
try {
  await connectDatabase();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const result = await new Promise((resolve, reject) => {
    const child = spawn("python", [path.join(adminBackend, "check_cross_project.py")], {
      stdio: "inherit", env: { ...process.env,
        NODE_ENV: "test", APP_ENV: "test", ENVIRONMENT: "test", RENDER: "false",
        MONGO_URL: "mongodb://127.0.0.1:27019", DB_NAME: `admincore_cross_test_${randomUUID().replaceAll("-", "")}`,
        POS_CORE_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        POS_CORE_API_KEY: process.env.ADMINCORE_API_KEY, CROSS_PROJECT_PREFIX: prefix,
      },
    });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (result !== 0) throw new Error(`Cross-project tests failed (${result})`);
} finally {
  const businesses = await prisma.business.findMany({ where: { name: { startsWith: prefix } }, select: { id: true, tenantId: true } });
  for (const business of businesses) {
    const users = await prisma.user.findMany({ where: { businessId: business.id }, select: { id: true } });
    await prisma.authSession.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
    await prisma.backgroundJob.deleteMany({ where: { type: "admincore.notify-change", payload: { path: ["business_id"], equals: business.id } } });
    await prisma.adminCoreSyncLog.deleteMany({ where: { tenantId: business.tenantId } });
    await prisma.stateDocument.deleteMany({ where: { key: `saas:${business.id}` } });
    await prisma.business.delete({ where: { id: business.id } });
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
}
