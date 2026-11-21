import "../src/config/env.js";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.POS_AUDIT_API_ORIGIN || "http://localhost:4001";
const login = await fetch(`${origin}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL || "owner@pos.com", password: process.env.ADMIN_PASSWORD || "admin123", business_id: process.env.DEFAULT_BUSINESS_ID || "demo-business" }) });
if (!login.ok) throw new Error(`Cannot authenticate backup reader (${login.status})`);
const session = (await login.json()).data.session_id;
try {
  const response = await fetch(`${origin}/api/central-kitchen`, { headers: { "x-cf-session-id": session } });
  if (!response.ok) throw new Error(`Cannot read current kitchen state (${response.status})`);
  const snapshot = await response.json();
  const directory = new URL("../data/central-preservation/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const filename = `before-repair-${Date.now()}.json`;
  await writeFile(new URL(filename, directory), JSON.stringify({ captured_at: new Date().toISOString(), snapshot }, null, 2));
  console.log(JSON.stringify({ backup: `backend/data/central-preservation/${filename}`, purchase_orders: snapshot.purchase_orders?.length || 0, routes: snapshot.route_plans?.length || 0, legacy_stock_rows: snapshot.outlet_inventory?.length || 0, restock_logs: snapshot.restock_logs?.length || 0 }));
} finally {
  await fetch(`${origin}/api/auth/logout`, { method: "POST", headers: { "x-cf-session-id": session, "content-type": "application/json" }, body: "{}" }).catch(() => {});
}
