import prisma from "../src/database/prisma/client.js";
import { synchronizeCustomerHistory } from "../src/core/customers/customer-history.js";
import { runTenantScope } from "../src/database/prisma/tenant-context.js";
const businessId = process.argv[2];
try {
  if (!businessId) throw new Error("Supply the exact business ID to repair");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  await runTenantScope({ businessId, tenantId: business.tenantId }, async () => {
    const before = await prisma.customer.count();
    await synchronizeCustomerHistory(businessId);
    console.log(JSON.stringify({ business: businessId, profiles_before: before, profiles_after: await prisma.customer.count() }));
  });
} finally { await prisma.$disconnect(); }
