import { Prisma } from "@prisma/client";

// Timestamps are stored as UTC "timestamp without time zone". A JavaScript Date passed to raw SQL arrives as
// "timestamp with time zone" and PostgreSQL converts it with the session's TimeZone setting, so on a server that is
// not set to UTC every comparison would shift by its offset. Always pass instants through this helper.
export const sqlTime = (value) => Prisma.sql`${new Date(value).toISOString()}::timestamp`;
