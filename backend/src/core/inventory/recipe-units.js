import { createHttpError } from "../../shared/utils/http-error.js";

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

export function convertRecipeQuantity(quantity, from, to) {
  const target = normalize(to);
  const source = normalize(from) || target;
  if (!Number.isFinite(quantity) || quantity <= 0) throw createHttpError({ statusCode: 400, message: "Recipe quantity must be positive" });
  if (source === target) return quantity;
  const a = units.get(source), b = units.get(target);
  if (!a || !b || a.dimension !== b.dimension) throw createHttpError({ statusCode: 409, message: `Cannot convert recipe unit ${source} to inventory unit ${target}. Correct the recipe units.` });
  return quantity * a.factor / b.factor;
}
