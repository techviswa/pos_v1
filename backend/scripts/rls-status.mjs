import prisma from "../src/database/prisma/client.js";
import { PrismaClient } from "@prisma/client";
import { verifyRlsConnection } from "../src/database/prisma/rls-health.js";
try {
  console.log(JSON.stringify(await prisma.$queryRawUnsafe(`SELECT current_user, rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname=current_user`)));
  console.log(JSON.stringify(await prisma.$queryRawUnsafe(`SELECT count(*)::int AS tables, count(*) FILTER (WHERE relrowsecurity)::int AS rls_tables FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'`)));
  console.log(JSON.stringify(await prisma.$queryRawUnsafe(`SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema`)));
  if (process.env.TENANT_DATABASE_URL && process.env.SYSTEM_DATABASE_URL) {
    const tenant = new PrismaClient({ datasourceUrl: process.env.TENANT_DATABASE_URL });
    try {
      console.log(JSON.stringify({ runtime: await verifyRlsConnection(tenant), system: await verifyRlsConnection(prisma, { system: true }) }));
    } finally { await tenant.$disconnect(); }
  } else console.log("RLS runtime activation pending: separate system and tenant connection URLs are not configured.");
} finally { await prisma.$disconnect(); }
