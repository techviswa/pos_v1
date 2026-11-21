// Read-only snapshot for the project issue inventory. No customer contact data,
// credentials, migrations, application writes or fixture creation.
import prisma from "../src/database/prisma/client.js";
try {
  const owner = await prisma.user.findFirst({ where: { email: "owner@pos.com", businessId: process.env.DEFAULT_BUSINESS_ID || "demo-business" }, select: { businessId: true } });
  if (!owner) throw new Error("Local owner business was not found");
  const businessId = owner.businessId;
  const [outlets, ingredients, movements, outletStock, allocations, feedback, products, jobs] = await Promise.all([
    prisma.outlet.findMany({ where: { businessId }, select: { id: true, name: true, status: true } }),
    prisma.inventoryItem.findMany({ where: { businessId }, select: { id: true, name: true, stock: true, unit: true, reorderLevel: true } }),
    prisma.inventoryMovement.findMany({ where: { businessId, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } }, select: { inventoryItemId: true, outletId: true, movementType: true, quantity: true } }),
    prisma.outletInventory.findMany({ where: { outlet: { businessId } }, select: { stock: true } }),
    prisma.allocation.groupBy({ by: ["status"], where: { businessId }, _count: true }),
    prisma.feedback.findMany({ where: { businessId }, select: { rating: true } }),
    prisma.product.findMany({ where: { businessId, active: true }, select: { recipeLines: true, channelSettings: true } }),
    prisma.backgroundJob.groupBy({ by: ["type", "status"], where: { OR: [{ payload: { path: ["business_id"], equals: businessId } }, { payload: { path: ["businessId"], equals: businessId } }] }, _count: true }),
  ]);
  const bridgeOutlets = outlets.filter((outlet) => outlet.name.startsWith("AdminCore Bridge Outlet"));
  const atRisk = ingredients.filter((item) => item.stock <= Math.max(item.reorderLevel, 10));
  const thresholdOnly = atRisk.filter((item) => item.stock > item.reorderLevel);
  const history = (id) => movements.filter((row) => row.inventoryItemId === id && ["consumption", "bill_deduction"].includes(row.movementType)).reduce((sum, row) => sum + Math.abs(row.quantity), 0);
  console.log(JSON.stringify({ business_id: businessId,
    outlets: { total: outlets.length, bridge_named: bridgeOutlets.length, bridge_statuses: bridgeOutlets.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {}) },
    inventory: { ingredients: ingredients.length, outlet_stock_rows: outletStock.length, nonzero_outlet_stock_rows: outletStock.filter((row) => row.stock > 0).length,
      current_at_risk: atRisk.length, flagged_only_by_fixed_floor_of_10: thresholdOnly.length,
      at_risk_without_consumption: atRisk.filter((item) => history(item.id) === 0).length,
      fractional_daily_use_below_one: ingredients.filter((item) => history(item.id) > 0 && history(item.id) / 30 < 1).length,
      consumption_at_outlets: movements.filter((row) => row.outletId && ["consumption", "bill_deduction"].includes(row.movementType)).length },
    allocations, background_jobs: jobs,
    feedback: { records: feedback.length, rated: feedback.filter((row) => Number.isInteger(row.rating) && row.rating >= 1).length, unrated: feedback.filter((row) => row.rating == null).length },
    menu_setup: { active_products: products.length, base_recipes: products.filter((row) => Array.isArray(row.recipeLines) && row.recipeLines.length).length,
      dish_allergens_reviewed: products.filter((row) => row.channelSettings?.qr?.allergens_reviewed === true).length },
  }, null, 2));
} finally { await prisma.$disconnect(); }
