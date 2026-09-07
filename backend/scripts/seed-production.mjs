import prisma from "../src/database/prisma/client.js";
import { ensureAccessControlSeed } from "../src/database/prisma/helpers.js";

try {
  await ensureAccessControlSeed();
  console.log("Required access-control defaults are ready; no demo businesses, outlets, or users created.");
} finally {
  await prisma.$disconnect();
}
