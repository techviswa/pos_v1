import { mergeDemand, saleDemand } from "./saleDemand";

const recipeFor = (product) => product?.recipe_lines || [];
const tea = { id: "tea", stock: 1, recipe_lines: [{ inventory_id: "leaf", quantity: 5, unit: "g" }] };
const bun = { id: "bun", stock: 10, recipe_lines: [] };
const combo = { id: "combo", is_combo: true, stock: 1, combo_components: [{ product_id: "tea", quantity: 1 }, { product_id: "bun", quantity: 2 }], recipe_lines: [{ inventory_id: "ignored", quantity: 1 }] };
const meal = { id: "meal", stock: 5, recipe_lines: [], modifier_groups: [{ options: [{ id: "with-tea", linked_product_id: "tea" }, { id: "extra-shot", recipe_lines: [{ inventory_id: "coffee", quantity: 9, unit: "g" }] }] }] };
const productsById = { tea, bun, combo, meal };

test("a combo uses its components' stock and recipes, not its own", () => {
  const demand = saleDemand({ product: combo, quantity: 2, productsById, recipeFor });
  expect(demand.stock).toEqual({ tea: 2, bun: 4 });
  expect(demand.recipes).toEqual([{ lines: tea.recipe_lines, multiplier: 2 }, { lines: [], multiplier: 4 }]);
});

test("chosen options use their linked product and their own recipe", () => {
  const demand = saleDemand({ product: meal, quantity: 1, modifierIds: ["with-tea", "extra-shot"], productsById, recipeFor });
  expect(demand.stock).toEqual({ meal: 1, tea: 1 });
  expect(demand.recipes.map((row) => row.lines[0]?.inventory_id)).toEqual([undefined, "leaf", "coffee"]);
});

test("a tea and a combo containing tea together need two teas", () => {
  const total = [saleDemand({ product: tea, productsById, recipeFor }), saleDemand({ product: combo, productsById, recipeFor })].reduce(mergeDemand, { stock: {}, recipes: [] });
  expect(total.stock.tea).toBe(2); // only 1 in stock: the till must refuse, as the server does
});
