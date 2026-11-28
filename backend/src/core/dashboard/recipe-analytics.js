import prisma from "../../database/prisma/client.js";
import { convertRecipeQuantity } from "../inventory/recipe-units.js";

/** invoiceCounts: productId -> bills containing it (report-accumulators productInvoiceTally) for the period. */
export async function recipeAnalytics({ businessId, outletId = null, invoiceCounts = new Map(), period = {} }) {
  const [catalog, ingredients, balances, movements] = await Promise.all([
    prisma.product.findMany({ where: { businessId }, include: { variations: true, addons: true, comboComponents: true, modifierGroups: { include: { options: true } }, outletLinks: outletId ? { where: { outletId } } : false } }),
    prisma.inventoryItem.findMany({ where: { businessId } }),
    outletId ? prisma.outletInventory.findMany({ where: { outletId, outlet: { businessId } } }) : [],
    // Usage per ingredient summed in PostgreSQL rather than loading every movement of the period.
    prisma.inventoryMovement.groupBy({ by: ["inventoryItemId"], _sum: { quantity: true }, where: { businessId, movementType: { in: ["consumption", "bill_deduction"] }, quantity: { lt: 0 }, ...(outletId ? { outletId } : {}), ...((period.start || period.end) ? { createdAt: { ...(period.start ? { gte: period.start } : {}), ...(period.end ? { lt: period.end } : {}) } } : {}) } }),
  ]);
  const byId = new Map(catalog.map((row) => [row.id, row]));
  const inventory = new Map(ingredients.map((row) => [row.id, row]));
  const products = catalog.filter((row) => row.active && (!outletId || row.outletLinks.some((link) => link.enabled)));
  const baseLines = (product, path = new Set()) => {
    if (!product || path.has(product.id)) return null;
    if (!product.isCombo) return product.recipeLines || [];
    const next = new Set([...path, product.id]), result = [];
    for (const part of product.comboComponents) {
      const lines = baseLines(byId.get(part.componentProductId), next);
      if (lines === null) return null;
      result.push(...lines.map((line) => ({ ...line, quantity: Number(line.quantity) * part.quantity })));
    }
    return result;
  };
  const evaluate = (lines) => {
    if (lines === null) return { cost: null, available: null, invalid: true };
    const demand = new Map(); let cost = 0;
    try {
      for (const line of lines) {
        const id = line.inventory_id || line.inventoryId, item = inventory.get(id);
        if (!item) return { cost: null, available: null, invalid: true };
        const quantity = convertRecipeQuantity(Number(line.quantity), line.unit, item.unit);
        demand.set(id, (demand.get(id) || 0) + quantity);
      }
      let available = Infinity;
      for (const [id, quantity] of demand) {
        const item = inventory.get(id), balance = outletId ? balances.find((row) => row.inventoryItemId === id && row.enabled) : item;
        if (!balance) return { cost: null, available: null, invalid: true };
        cost += quantity * Number(balance.unitCost ?? item.conversionCost);
        available = Math.min(available, Math.floor((balance.stock + 1e-9) / quantity));
      }
      return { cost: Math.round(cost * 100) / 100, available: Number.isFinite(available) ? available : null, invalid: false };
    } catch { return { cost: null, available: null, invalid: true }; }
  };
  const rows = products.map((product) => {
    const lines = baseLines(product), base = evaluate(lines);
    const variationCosts = product.variations.map((row) => evaluate(row.recipeLines || []));
    const addonCosts = product.addons.map((row) => row.linkedProductId ? evaluate(baseLines(byId.get(row.linkedProductId))) : evaluate(row.recipeLines || []));
    const addonLines = product.addons.flatMap((row) => row.linkedProductId ? baseLines(byId.get(row.linkedProductId)) || [] : row.recipeLines || []);
    const choiceLines = product.modifierGroups.filter((group) => group.active !== false).flatMap((group) => group.options.filter((option) => option.active !== false)).flatMap((row) => row.linkedProductId ? baseLines(byId.get(row.linkedProductId)) || [] : row.recipeLines || []);
    const nodes = (lines?.length || 0) + product.variations.reduce((sum, row) => sum + (row.recipeLines?.length || 0), 0) + addonLines.length + choiceLines.length;
    const invoiceCount = invoiceCounts.get(product.id) || 0;
    return { id: product.id, name: product.name, category: product.category, price: Number(product.price), base_lines: lines?.length || 0, variation_lines: product.variations.reduce((sum, row) => sum + (row.recipeLines?.length || 0), 0), addon_lines: addonLines.length, total_recipe_nodes: nodes, base_recipe_cost: base.cost,
      variation_recipe_cost: variationCosts.some((row) => row.invalid) ? null : Math.max(0, ...variationCosts.map((row) => row.cost)),
      addon_recipe_cost: addonCosts.some((row) => row.invalid) ? null : addonCosts.reduce((sum, row) => sum + row.cost, 0),
      recipe_needs_review: base.invalid || variationCosts.some((row) => row.invalid) || addonCosts.some((row) => row.invalid) || evaluate(choiceLines).invalid, ingredient_blocked: !base.invalid && base.available != null && base.available < 1,
      available_units: base.available, orders_with_recipe: invoiceCount };
  });
  const covered = rows.filter((row) => row.total_recipe_nodes > 0);
  const usage = new Map();
  for (const line of movements) {
    const item = inventory.get(line.inventoryItemId); if (!item) continue;
    const previous = usage.get(item.id) || { inventory_id: item.id, ingredient_name: item.name, unit: item.unit, quantity_used: 0 };
    previous.quantity_used += Math.abs(line._sum.quantity || 0); usage.set(item.id, previous);
  }
  return { products: rows, ingredient_usage: [...usage.values()], recipe_product_count: covered.length, blocked_product_count: rows.filter((row) => row.ingredient_blocked).length,
    review_needed_products: rows.filter((row) => row.recipe_needs_review).length,
    recipe_coverage_percent: products.length ? Math.round(covered.length / products.length * 1000) / 10 : 0,
    top_recipe_cost_products: [...covered].sort((a, b) => (b.base_recipe_cost || 0) - (a.base_recipe_cost || 0)).slice(0, 10),
    top_ingredient_usage: [...usage.values()].sort((a, b) => b.quantity_used - a.quantity_used).slice(0, 10),
    most_ordered_recipe_products: rows.filter((row) => row.orders_with_recipe > 0).sort((a, b) => b.orders_with_recipe - a.orders_with_recipe).slice(0, 10) };
}
