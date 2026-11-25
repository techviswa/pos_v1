import { convertRecipeQuantity } from "./recipeUnits";
import { summarizeRecipeLines } from "../pages/Billing";
import { computeDraftRecipeCost } from "../pages/Products";

jest.mock("../components/Layout", () => ({ Layout: ({ children }) => children }));
jest.mock("react-router-dom", () => ({ Link: () => null, useLocation: () => ({}), useNavigate: () => () => {}, useParams: () => ({}) }), { virtual: true });

test("recipe quantities convert to the unit stock is counted in, like the server", () => {
  expect(convertRecipeQuantity(150, "ml", "l")).toBeCloseTo(0.15);
  expect(convertRecipeQuantity(18, "g", "kg")).toBeCloseTo(0.018);
  expect(convertRecipeQuantity(2, "pcs", "unit")).toBe(2);
  expect(convertRecipeQuantity(5, "kg", "kg")).toBe(5);
  expect(convertRecipeQuantity(5, "", "kg")).toBe(5);
  expect(convertRecipeQuantity(10, "g", "ml")).toBeNull();
});

test("the till compares a cup's 150 ml of milk with 24.7 l of stock, not 150 with 24.7", () => {
  const lines = [{ inventory_id: "milk", ingredient_name: "Milk", quantity: 150, unit: "ml" }, { inventory_id: "beans", ingredient_name: "Coffee Beans", quantity: 18, unit: "g" }];
  const demand = summarizeRecipeLines(lines, 2, { milk: "l", beans: "kg" });
  expect(demand.milk.quantity).toBeCloseTo(0.3);
  expect(demand.milk.unit).toBe("l");
  expect(demand.beans.quantity).toBeCloseTo(0.036);
  expect(demand.milk.quantity < 24.7).toBe(true);
});

test("recipe cost uses the ingredient's price per stock unit", () => {
  const catalog = [{ id: "milk", unit: "l", conversion_cost: 60 }, { id: "beans", unit: "kg", conversion_cost: 900 }];
  expect(computeDraftRecipeCost([{ inventory_id: "milk", quantity: 150, unit: "ml" }, { inventory_id: "beans", quantity: 18, unit: "g" }], catalog)).toBeCloseTo(25.2);
});
