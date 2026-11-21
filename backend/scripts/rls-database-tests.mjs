import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import prisma from "../src/database/prisma/client.js";
import { runTenantScope } from "../src/database/prisma/tenant-context.js";
import { verifyRlsConnection } from "../src/database/prisma/rls-health.js";

if (!process.env.TENANT_DATABASE_URL) throw new Error("TENANT_DATABASE_URL is required: RLS tests cannot silently skip");
const restricted = new PrismaClient({ datasourceUrl: process.env.TENANT_DATABASE_URL });
const id = randomUUID(), a = `rls-a-${id}`, b = `rls-b-${id}`;
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const denied = async (work) => { await assert.rejects(work); checks++; };
const inBusiness = (businessId, work, tenantId = `tenant-${businessId}`) => restricted.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('pos.business_id', ${businessId}, true), set_config('pos.tenant_id', ${tenantId}, true)`;
  return work(tx);
});
try {
  check((await verifyRlsConnection(restricted)).protected_models, 62);
  // A table owner/system URL must fail the runtime credential health check.
  const owner = new PrismaClient();
  try { await denied(verifyRlsConnection(owner)); } finally { await owner.$disconnect(); }
  for (const businessId of [a, b]) await prisma.business.create({ data: { id: businessId, tenantId: `tenant-${businessId}`, name: businessId } });
  const pa = await prisma.product.create({ data: { businessId: a, name: "A", category: "Food", price: 10 } });
  const pb = await prisma.product.create({ data: { businessId: b, name: "B", category: "Food", price: 20 } });
  const order = await prisma.order.create({ data: { businessId: a, customerName: "RLS fixture", channel: "pos", status: "open", total: 10 } });
  const vb = await prisma.variation.create({ data: { productId: pb.id, name: "B variation", price: 2 } });
  await prisma.stateDocument.create({ data: { key: `print:${b}:secret`, data: { business_id: b } } });
  // These use an unextended Prisma client: no application where filters/guard.
  check(await restricted.product.count(), 0);
  check(await restricted.business.count(), 0);
  await inBusiness(a, async (tx) => {
    check((await tx.product.findMany()).map((row) => row.id), [pa.id]);
    check(await tx.product.findUnique({ where: { id: pb.id } }), null);
    check(await tx.variation.findUnique({ where: { id: vb.id } }), null);
    check(await tx.stateDocument.findUnique({ where: { key: `print:${b}:secret` } }), null);
    check((await tx.product.updateMany({ where: { id: pb.id }, data: { name: "attack" } })).count, 0);
    check((await tx.product.deleteMany({ where: { id: pb.id } })).count, 0);
    check((await tx.$queryRaw`SELECT id FROM "Product"`).map((row) => row.id), [pa.id]);
  });
  await denied(inBusiness(a, (tx) => tx.product.create({ data: { businessId: b, name: "Attack", category: "Food", price: 1 } })));
  await denied(inBusiness(a, (tx) => tx.product.update({ where: { id: pa.id }, data: { businessId: b } })));
  await denied(inBusiness(a, (tx) => tx.orderItem.create({ data: { orderId: order.id, productId: pb.id, name: "Foreign reference", quantity: 1, price: 1 } })));
  await denied(inBusiness(a, (tx) => tx.stateDocument.create({ data: { key: `print:${b}:forged`, data: { business_id: a } } })));
  await denied(restricted.product.create({ data: { businessId: a, name: "No scope", category: "Food", price: 1 } }));
  await denied(inBusiness(a, (tx) => tx.$executeRawUnsafe('TRUNCATE TABLE "Product" CASCADE')));
  await denied(inBusiness(a, (tx) => tx.$executeRawUnsafe('ALTER TABLE "Product" DISABLE ROW LEVEL SECURITY')));
  await denied(inBusiness(a, (tx) => tx.$executeRawUnsafe('CREATE TABLE public.rls_attack (id text)')));
  await denied(inBusiness(a, async (tx) => { await tx.$executeRawUnsafe('SET LOCAL row_security = off'); await tx.product.findMany(); }));
  check(await inBusiness(a, (tx) => tx.product.count(), `tenant-${b}`), 0);
  const [{ owner: ownerName }] = await prisma.$queryRawUnsafe('SELECT current_user AS owner');
  await denied(restricted.$executeRawUnsafe(`SET ROLE "${ownerName.replaceAll('"', '""')}"`));
  await Promise.all(Array.from({ length: 32 }, (_, index) => inBusiness(index % 2 ? a : b, async (tx) => {
    const rows = await tx.product.findMany();
    check(rows.map((row) => row.businessId), [index % 2 ? a : b]);
  })));
  check(await restricted.product.count(), 0); // transaction context did not leak through pool
  const scoped = (businessId, work) => runTenantScope({ businessId, tenantId: `tenant-${businessId}` }, work);
  await scoped(a, async () => {
    check((await prisma.$queryRaw`SELECT id FROM "Product"`).map((row) => row.id), [pa.id]);
    await prisma.$transaction(async (tx) => {
      check((await tx.$queryRaw`SELECT current_user AS name`)[0].name, new URL(process.env.TENANT_DATABASE_URL).username);
      const created = await tx.product.create({ data: { businessId: a, name: "TX", category: "Food", price: 1, variations: { create: { name: "TX child", price: 1 } } } });
      check((await tx.product.findUnique({ where: { id: created.id } })).businessId, a);
    });
    await denied(prisma.$transaction(async (tx) => { await tx.product.create({ data: { businessId: a, name: "rolled back", category: "Food", price: 1 } }); throw new Error("rollback"); }));
    check(await prisma.product.count({ where: { name: "rolled back" } }), 0);
  });
  check((await prisma.product.findUnique({ where: { id: pb.id } })).name, "B");
  console.log(`Database RLS passed: ${checks} checks without application filters, raw SQL, writes, foreign references, role escape, missing/mismatched context, pooled concurrency and application transactions`);
} finally {
  await prisma.business.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.stateDocument.deleteMany({ where: { key: { contains: id } } });
  await Promise.all([restricted.$disconnect(), prisma.$disconnect()]);
}
