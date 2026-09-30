import { createHttpError } from "../../shared/utils/http-error.js";
import { loadActiveRules, priceLine, pricingInclude, roundMoney } from "../menu/menu-pricing.js";

export const MAX_ORDER_LINES = 200;
export const MAX_LINE_QUANTITY = 999;
const MAX_OPEN_ITEM_PRICE = 1_000_000;

const bad = (code, message) => createHttpError({ statusCode: 400, code, message });

export const parseQuantity = (raw) => {
  const quantity = raw === undefined || raw === null || raw === "" ? 1 : Number(raw);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw bad("INVALID_QUANTITY", `quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}`);
  }
  return quantity;
};

/**
 * The server, not the browser, decides what an item costs.
 *
 * Every line is matched to a product of THIS business and priced by the shared menu price engine: outlet/channel
 * price, variation, add-ons, modifier options (with each group's min/max enforced) and any active price rule.
 * Client-sent prices are ignored. Lines without a product ("open items") are refused unless the caller may key in a
 * price (Owner/Manager). Quantities must be whole numbers in a sane range.
 *
 * Other client fields (notes, removed ingredients...) are preserved; the line name is rebuilt when modifiers apply.
 */
export const resolveTrustedItems = async ({
  client,
  businessId,
  items,
  allowOpenPrice = false,
  outletId = null,
  channel = "Dine-In",
  salesChannel = null,
  at = new Date(),
}) => {
  const lines = Array.isArray(items) ? items : [];
  if (lines.length > MAX_ORDER_LINES) throw bad("TOO_MANY_LINES", `An order can have at most ${MAX_ORDER_LINES} lines`);

  const productIdOf = (item) => item?.productId || item?.product_id || item?.id || null;
  const ids = [...new Set(lines.map(productIdOf).filter(Boolean).map(String))];
  const [products, rules] = await Promise.all([
    ids.length
      ? client.product.findMany({ where: { businessId, id: { in: ids } }, include: pricingInclude(outletId) })
      : [],
    loadActiveRules(client, businessId),
  ]);
  const byId = new Map(products.map((product) => [product.id, product]));

  return lines.map((item) => {
    if (!item || typeof item !== "object") throw bad("INVALID_ITEM", "Each item must be an object");
    const quantity = parseQuantity(item.quantity);
    const productId = productIdOf(item);

    if (!productId) {
      if (!allowOpenPrice) throw bad("PRODUCT_REQUIRED", "Every item must reference a product");
      const price = Number(item.price);
      if (!Number.isFinite(price) || price < 0 || price > MAX_OPEN_ITEM_PRICE) throw bad("INVALID_PRICE", "Open item price is invalid");
      return { ...item, productId: null, quantity, price: roundMoney(price), modifiers: null };
    }

    const product = byId.get(String(productId));
    if (!product) throw bad("UNKNOWN_PRODUCT", "One or more items are not products of this business");
    return priceLine({
      product,
      item,
      quantity,
      outletLink: outletId ? product.outletLinks?.[0] || null : null,
      channel,
      salesChannel: salesChannel || channel,
      outletId,
      at,
      rules,
    });
  });
};
