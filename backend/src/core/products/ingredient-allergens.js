import prisma from "../../database/prisma/client.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { publishChange } from "../../services/realtime/realtime.service.js";

const keyFor = (businessId, id) => `ingredient-allergens:${businessId}:${id}`;
const fail = (message) => { throw createHttpError({ statusCode: 400, message }); };
export function normalizeIngredientAllergens(payload = {}) {
  const result = {};
  for (const name of ["allergens", "may_contain"]) {
    const list = payload[name] || [];
    if (!Array.isArray(list) || list.length > 20 || list.some((item) => typeof item !== "string" || !item.trim() || item.length > 60)) fail("Enter up to 20 allergen names, each at most 60 characters");
    result[name] = [...new Set(list.map((item) => item.trim()))];
  }
  if (typeof payload.reviewed !== "boolean") fail("Confirm whether the ingredient information has been reviewed");
  result.reviewed = payload.reviewed;
  return result;
}
export const ingredientAllergensService = {
  async catalog({ businessId }) {
    const [items, documents] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { businessId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.stateDocument.findMany({ where: { key: { startsWith: `ingredient-allergens:${businessId}:` } } }),
    ]);
    const details = new Map(documents.map((row) => [row.data.ingredient_id, row.data]));
    return items.map((item) => ({ ...item, ...(details.get(item.id) || { allergens: [], may_contain: [], reviewed: false }) }));
  },
  async save({ businessId, ingredientId, payload, user }) {
    const data = normalizeIngredientAllergens(payload);
    return prisma.$transaction(async (tx) => {
      const ingredient = await tx.inventoryItem.findFirst({ where: { id: ingredientId, businessId }, select: { id: true } });
      if (!ingredient) throw createHttpError({ statusCode: 404, message: "Ingredient not found" });
      const key = keyFor(businessId, ingredientId);
      const value = { ...data, business_id: businessId, ingredient_id: ingredientId, reviewed_at: data.reviewed ? new Date().toISOString() : null, reviewed_by: data.reviewed ? user?.id || null : null };
      await tx.stateDocument.upsert({ where: { key }, create: { key, data: value }, update: { data: value } });
      await publishChange({ businessId, resource: "products", action: "ingredient_allergens_updated", recordId: ingredientId }, { tx });
      return value;
    });
  },
};

// Conservative union across base recipes and every available customisation. Removing an
// ingredient in a guest note never removes an allergen warning or certifies safety.
export async function recipeAllergenDetails(products, businessId) {
  const ingredients = await ingredientAllergensService.catalog({ businessId });
  const ingredientMap = new Map(ingredients.map((item) => [item.id, item]));
  const byId = new Map(products.map((product) => [product.id, product]));
  const result = new Map();
  const derive = (product, path = new Set()) => {
    const qr = product.channelSettings?.qr || product.channelSettings?.qr_ordering || {};
    const allergens = new Set(qr.allergens || []), mayContain = new Set(qr.may_contain || []);
    let reviewed = qr.allergens_reviewed === true, count = 0, missing = 0;
    if (path.has(product.id)) return { allergens: [...allergens], may_contain: [...mayContain], allergens_reviewed: false, recipe_ingredients: 0, unreviewed_ingredients: 1 };
    const nextPath = new Set([...path, product.id]);
    const collect = (lines) => {
      for (const line of Array.isArray(lines) ? lines : []) {
        const ingredient = ingredientMap.get(line.inventory_id || line.inventoryId); count++;
        if (!ingredient?.reviewed) { reviewed = false; missing++; }
        for (const value of ingredient?.allergens || []) allergens.add(value);
        for (const value of ingredient?.may_contain || []) mayContain.add(value);
      }
    };
    const linked = (id) => {
      const item = byId.get(id);
      if (!item) { reviewed = false; missing++; return; }
      const info = derive(item, nextPath);
      info.allergens.forEach((value) => allergens.add(value)); info.may_contain.forEach((value) => mayContain.add(value));
      reviewed = reviewed && info.allergens_reviewed; count += info.recipe_ingredients; missing += info.unreviewed_ingredients;
    };
    collect(product.recipeLines);
    for (const variation of product.variations || []) collect(variation.recipeLines);
    for (const addon of product.addons || []) { collect(addon.recipeLines); if (addon.linkedProductId) linked(addon.linkedProductId); }
    for (const group of product.modifierGroups || []) for (const option of group.options || []) {
      if (option.active === false) continue;
      collect(option.recipeLines); if (option.linkedProductId) linked(option.linkedProductId);
    }
    for (const component of product.comboComponents || []) linked(component.componentProductId);
    return { allergens: [...allergens], may_contain: [...mayContain], allergens_reviewed: reviewed, recipe_ingredients: count, unreviewed_ingredients: missing };
  };
  for (const product of products) result.set(product.id, derive(product));
  return result;
}
