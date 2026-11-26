// What selling `quantity` of a configured item uses up, exactly as the server deducts it
// (backend/src/services/workflows/order-fulfillment.service.js):
// - a combo sells its components: their product stock and their recipes, not the combo's own;
// - any other item uses its own stock and its recipe (with variation/add-ons/removals applied by `recipeFor`);
// - a chosen option linked to another product (the drink in a meal deal) sells that product too;
// - a chosen option with its own recipe (extra shot, extra cheese) uses those ingredients.
// Returns { stock: { productId: units }, recipes: [{ lines, multiplier }] }.
export const saleDemand = ({ product, quantity = 1, variation = "", addons = [], removals = [], modifierIds = [], productsById = {}, recipeFor }) => {
  const stock = {};
  const recipes = [];
  const addStock = (productId, units) => { if (productId) stock[productId] = (stock[productId] || 0) + units; };
  const components = product?.is_combo ? product.combo_components || [] : [];
  if (components.length) {
    for (const component of components) {
      const units = quantity * Math.max(1, Math.floor(Number(component.quantity) || 1));
      addStock(component.product_id, units);
      const part = productsById[component.product_id];
      if (part) recipes.push({ lines: recipeFor(part, "", [], removals), multiplier: units });
    }
  } else {
    addStock(product?.id, quantity);
    recipes.push({ lines: recipeFor(product, variation, addons, removals), multiplier: quantity });
  }
  const chosen = (product?.modifier_groups || []).flatMap((group) => group.options || []).filter((option) => modifierIds.includes(option.id));
  for (const option of chosen) {
    if (option.linked_product_id) {
      addStock(option.linked_product_id, quantity);
      const linked = productsById[option.linked_product_id];
      if (linked) recipes.push({ lines: recipeFor(linked, "", [], removals), multiplier: quantity });
    }
    if (Array.isArray(option.recipe_lines) && option.recipe_lines.length) recipes.push({ lines: option.recipe_lines, multiplier: quantity });
  }
  return { stock, recipes };
};

/** Adds one sale's demand into running totals: { stock: {...}, recipes: [...] }. */
export const mergeDemand = (total, demand) => {
  for (const [productId, units] of Object.entries(demand.stock)) total.stock[productId] = (total.stock[productId] || 0) + units;
  total.recipes.push(...demand.recipes);
  return total;
};
