import { createHttpError } from "../../shared/utils/http-error.js";
import { assertOwnedIds } from "../../database/prisma/scope.js";

const bad = (code, message) => createHttpError({ statusCode: 400, code, message });
const MAX_GROUPS = 20;
const MAX_OPTIONS = 50;

const toMoney = (value, label) => {
  const number = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw bad("INVALID_PRICE", `${label} must be a price of 0 or more`);
  return Math.round(number * 100) / 100;
};

/**
 * Saves the parts of a product that make up a richer menu: modifier groups, combo contents and outlet menu
 * settings. Each part is replaced only when the payload includes it. Runs inside the caller's transaction.
 */
export const saveMenuStructure = async ({ tx, businessId, productId, payload }) => {
  if (payload.modifier_groups !== undefined) {
    const groups = Array.isArray(payload.modifier_groups) ? payload.modifier_groups : [];
    if (groups.length > MAX_GROUPS) throw bad("TOO_MANY_GROUPS", `A product can have at most ${MAX_GROUPS} choice groups`);
    const linkedIds = groups.flatMap((group) => (group.options || []).map((option) => option.linked_product_id)).filter(Boolean);
    if (linkedIds.includes(productId)) throw bad("INVALID_LINK", "A choice cannot sell the product it belongs to");
    await assertOwnedIds({ kind: "product", ids: linkedIds, businessId, client: tx });

    await tx.modifierGroup.deleteMany({ where: { productId } });
    for (const [groupIndex, group] of groups.entries()) {
      const name = String(group.name || "").trim();
      if (!name) throw bad("GROUP_NAME_REQUIRED", "Every choice group needs a name");
      const options = (Array.isArray(group.options) ? group.options : []).filter((option) => String(option?.name || "").trim());
      if (!options.length) throw bad("GROUP_OPTIONS_REQUIRED", `"${name}" needs at least one option`);
      if (options.length > MAX_OPTIONS) throw bad("TOO_MANY_OPTIONS", `"${name}" can have at most ${MAX_OPTIONS} options`);
      const minSelect = Number(group.min_select ?? group.minSelect ?? 0);
      const maxSelect = Number(group.max_select ?? group.maxSelect ?? 1);
      if (!Number.isInteger(minSelect) || minSelect < 0) throw bad("INVALID_MIN", `"${name}": minimum must be 0 or more`);
      // 0 means "no upper limit".
      if (!Number.isInteger(maxSelect) || maxSelect < 0 || (maxSelect > 0 && maxSelect < minSelect)) {
        throw bad("INVALID_MAX", `"${name}": maximum must be 0 (no limit) or at least the minimum`);
      }
      if (minSelect > options.length) throw bad("INVALID_MIN", `"${name}": minimum is more than the number of options`);
      await tx.modifierGroup.create({
        data: {
          productId,
          name,
          minSelect,
          maxSelect,
          sortOrder: groupIndex,
          options: {
            create: options.map((option, optionIndex) => ({
              name: String(option.name).trim(),
              price: toMoney(option.price, `"${option.name}" price`),
              linkedProductId: option.linked_product_id || null,
              recipeLines: Array.isArray(option.recipe_lines) ? option.recipe_lines : [],
              active: option.active !== false,
              sortOrder: optionIndex,
            })),
          },
        },
      });
    }
  }

  if (payload.is_combo !== undefined || payload.combo_components !== undefined) {
    const isCombo = payload.is_combo !== undefined ? Boolean(payload.is_combo) : (payload.combo_components || []).length > 0;
    const components = isCombo && Array.isArray(payload.combo_components) ? payload.combo_components : [];
    if (isCombo && !components.length) throw bad("COMBO_EMPTY", "A combo needs at least one item");
    const merged = new Map();
    for (const component of components) {
      const id = String(component.product_id || component.productId || "");
      const quantity = Number(component.quantity ?? 1);
      if (!id) throw bad("COMBO_ITEM_REQUIRED", "Choose a product for every combo item");
      if (id === productId) throw bad("COMBO_SELF", "A combo cannot contain itself");
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw bad("INVALID_QUANTITY", "Combo item quantities must be 1 to 99");
      merged.set(id, (merged.get(id) || 0) + quantity);
    }
    await assertOwnedIds({ kind: "product", ids: [...merged.keys()], businessId, client: tx });
    // Combos are one level deep, which keeps stock and recipes unambiguous.
    const nested = await tx.product.count({ where: { id: { in: [...merged.keys()] }, isCombo: true } });
    if (nested) throw bad("COMBO_NESTED", "A combo cannot contain another combo");
    if (isCombo && (await tx.comboComponent.count({ where: { componentProductId: productId } }))) {
      throw bad("COMBO_NESTED", "This product is part of a combo, so it cannot be a combo itself");
    }
    await tx.comboComponent.deleteMany({ where: { comboProductId: productId } });
    if (merged.size) {
      await tx.comboComponent.createMany({
        data: [...merged.entries()].map(([componentProductId, quantity]) => ({ comboProductId: productId, componentProductId, quantity })),
      });
    }
    await tx.product.update({ where: { id: productId }, data: { isCombo } });
  }

  if (payload.outlet_overrides !== undefined) {
    // Outlet menus have one source: OutletProduct (the same rows the outlet screen edits).
    const overrides = Array.isArray(payload.outlet_overrides) ? payload.outlet_overrides : [];
    await assertOwnedIds({ kind: "outlet", ids: overrides.map((entry) => entry.outlet_id), businessId, client: tx });
    for (const entry of overrides) {
      const status = ["active", "inactive", "inherit"].includes(entry.status) ? entry.status : "inherit";
      const price = entry.price === null || entry.price === undefined || entry.price === "" ? null : toMoney(entry.price, "Outlet price");
      await tx.outletProduct.upsert({
        where: { outletId_productId: { outletId: entry.outlet_id, productId } },
        create: { outletId: entry.outlet_id, productId, enabled: status !== "inactive", priceOverride: price },
        update: { enabled: status !== "inactive", priceOverride: price },
      });
    }
    // The list is complete: outlets it leaves out go back to the product's normal price and availability.
    await tx.outletProduct.updateMany({
      where: { productId, outletId: { notIn: overrides.map((entry) => entry.outlet_id) } },
      data: { enabled: true, priceOverride: null },
    });
  }
};

/** A combo can be sold as many times as its scarcest component allows. */
export const comboAvailableStock = (product) => {
  if (!product.isCombo || !product.comboComponents?.length) return null;
  return Math.max(0, Math.min(...product.comboComponents.map((component) =>
    Math.floor(Number(component.component?.stock || 0) / Math.max(1, component.quantity)))));
};
