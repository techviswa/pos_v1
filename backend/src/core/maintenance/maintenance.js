import prisma from "../../database/prisma/client.js";

// Hourly housekeeping (MAINTENANCE=off disables it on an instance).
// Expired sign-in sessions are deleted; until now they stayed in the database forever.
export async function purgeExpiredSessions(now = new Date()) {
  const { count } = await prisma.authSession.deleteMany({ where: { expiresAt: { lt: now } } });
  return count;
}

let timer = null;
export function startMaintenance({ logger, intervalMs = 60 * 60 * 1000 } = {}) {
  if (timer || String(process.env.MAINTENANCE || "").toLowerCase() === "off") return;
  const tick = async () => {
    try {
      const removed = await purgeExpiredSessions();
      if (removed) logger?.info?.(`Removed ${removed} expired sign-in session(s)`);
    } catch (error) { logger?.warn?.(`Maintenance failed: ${error.message}`); }
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}
export const stopMaintenance = () => { clearInterval(timer); timer = null; };
