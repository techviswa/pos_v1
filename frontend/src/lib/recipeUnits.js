// Same unit rules as the server (backend/src/core/inventory/recipe-units.js): a recipe may say "150 ml" while the
// stock is counted in litres. Every comparison or cost made in the app must convert first, or 150 ml looks larger
// than 24.7 l.
const groups = [
  ["mass", 1, ["kg", "kilogram", "kilograms"]],
  ["mass", 0.001, ["g", "gm", "gram", "grams"]],
  ["mass", 0.000001, ["mg", "milligram", "milligrams"]],
  ["volume", 1, ["l", "ltr", "litre", "liter", "litres", "liters"]],
  ["volume", 0.001, ["ml", "millilitre", "milliliter", "millilitres", "milliliters"]],
  ["count", 1, ["unit", "units", "pc", "pcs", "piece", "pieces", "each", "nos"]],
];
const units = new Map(groups.flatMap(([dimension, factor, aliases]) => aliases.map((alias) => [alias, { dimension, factor }])));
const normalize = (unit) => String(unit || "").trim().toLowerCase();

/** `quantity` in `from` units expressed in `to` units, or null when the units cannot be converted (e.g. g to ml). */
export const convertRecipeQuantity = (quantity, from, to) => {
  const value = Number(quantity);
  if (!Number.isFinite(value)) return null;
  const target = normalize(to);
  const source = normalize(from) || target;
  if (!target || source === target) return value;
  const a = units.get(source), b = units.get(target);
  if (!a || !b || a.dimension !== b.dimension) return null;
  return (value * a.factor) / b.factor;
};
