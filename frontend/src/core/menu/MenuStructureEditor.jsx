import React from "react";

/**
 * Edits the richer menu parts of a product: choice groups ("Choose a bread", "Up to 3 toppings") and combo contents.
 * The server validates everything again; this only helps the person entering the menu.
 */
const emptyOption = () => ({ name: "", price: "", linked_product_id: "" });
const emptyGroup = () => ({ name: "", min_select: 1, max_select: 1, options: [emptyOption()] });

export const toMenuStructureForm = (product) => ({
  is_combo: Boolean(product?.is_combo),
  combo_components: (product?.combo_components || []).map((component) => ({
    product_id: component.product_id,
    quantity: component.quantity || 1,
  })),
  modifier_groups: (product?.modifier_groups || []).map((group) => ({
    name: group.name,
    min_select: group.min_select ?? 0,
    max_select: group.max_select ?? 1,
    options: (group.options || []).map((option) => ({
      name: option.name,
      price: option.price ?? "",
      linked_product_id: option.linked_product_id || "",
    })),
  })),
});

export const toMenuStructurePayload = (form) => ({
  is_combo: Boolean(form.is_combo),
  combo_components: form.is_combo
    ? form.combo_components.filter((component) => component.product_id).map((component) => ({
        product_id: component.product_id,
        quantity: Number(component.quantity || 1),
      }))
    : [],
  modifier_groups: form.modifier_groups
    .filter((group) => group.name.trim())
    .map((group) => ({
      name: group.name.trim(),
      min_select: Number(group.min_select || 0),
      max_select: Number(group.max_select || 0),
      options: group.options
        .filter((option) => option.name.trim())
        .map((option) => ({
          name: option.name.trim(),
          price: Number(option.price || 0),
          linked_product_id: option.linked_product_id || null,
        })),
    })),
});

/** Human-readable problem with the form, or "" when it can be saved. */
export const validateMenuStructure = (form) => {
  if (form.is_combo && !form.combo_components.some((component) => component.product_id)) return "Add at least one item to the combo.";
  for (const group of form.modifier_groups.filter((entry) => entry.name.trim())) {
    const options = group.options.filter((option) => option.name.trim());
    const min = Number(group.min_select || 0);
    const max = Number(group.max_select || 0);
    if (!options.length) return `"${group.name}" needs at least one option.`;
    if (!Number.isInteger(min) || min < 0) return `"${group.name}": minimum must be 0 or more.`;
    if (!Number.isInteger(max) || max < 0 || (max > 0 && max < min)) return `"${group.name}": maximum must be 0 (no limit) or at least the minimum.`;
    if (min > options.length) return `"${group.name}": minimum is more than the number of options.`;
  }
  return "";
};

export const MenuStructureEditor = ({ value, onChange, products = [], currentProductId = null }) => {
  const selectable = products.filter((product) => product.id !== currentProductId && !product.is_combo);
  const update = (patch) => onChange({ ...value, ...patch });
  const updateGroup = (index, patch) =>
    update({ modifier_groups: value.modifier_groups.map((group, groupIndex) => (groupIndex === index ? { ...group, ...patch } : group)) });
  const updateOption = (groupIndex, optionIndex, patch) =>
    updateGroup(groupIndex, {
      options: value.modifier_groups[groupIndex].options.map((option, index) => (index === optionIndex ? { ...option, ...patch } : option)),
    });

  return (
    <>
      <div className="cf-field">
        <label>
          <input type="checkbox" checked={value.is_combo} onChange={(event) => update({ is_combo: event.target.checked, combo_components: event.target.checked && !value.combo_components.length ? [{ product_id: "", quantity: 1 }] : value.combo_components })} />{" "}
          This is a combo / meal deal
        </label>
        {value.is_combo ? (
          <div data-testid="combo-editor" style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {value.combo_components.map((component, index) => (
              <div key={index} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select
                  className="cf-select"
                  aria-label={`Combo item ${index + 1}`}
                  value={component.product_id}
                  onChange={(event) => update({ combo_components: value.combo_components.map((entry, entryIndex) => (entryIndex === index ? { ...entry, product_id: event.target.value } : entry)) })}
                  style={{ flex: "1 1 180px" }}
                >
                  <option value="">Choose an item</option>
                  {selectable.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <input
                  className="cf-input"
                  aria-label={`Quantity of combo item ${index + 1}`}
                  type="number"
                  min="1"
                  max="99"
                  value={component.quantity}
                  onChange={(event) => update({ combo_components: value.combo_components.map((entry, entryIndex) => (entryIndex === index ? { ...entry, quantity: event.target.value } : entry)) })}
                  style={{ width: 90 }}
                />
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => update({ combo_components: value.combo_components.filter((_, entryIndex) => entryIndex !== index) })}>Remove</button>
              </div>
            ))}
            <button type="button" className="cf-btn cf-btn--secondary" onClick={() => update({ combo_components: [...value.combo_components, { product_id: "", quantity: 1 }] })}>Add combo item</button>
            <div className="cf-card__meta">Selling the combo uses up the stock and recipes of these items. The combo's own price is what the customer pays.</div>
          </div>
        ) : null}
      </div>

      <div className="cf-field" data-testid="modifier-editor">
        <label>Choice Groups</label>
        <div className="cf-card__meta" style={{ marginBottom: 8 }}>
          e.g. "Choose a bread" (min 1, max 1) or "Extra toppings" (min 0, max 3). Max 0 means no limit. Link an option to a product to sell and deduct that product too (like the drink in a meal).
        </div>
        {value.modifier_groups.map((group, groupIndex) => (
          <div key={groupIndex} className="cf-card cf-card--padded" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input className="cf-input" aria-label="Group name" placeholder="Group name, e.g. Choose a drink" value={group.name} onChange={(event) => updateGroup(groupIndex, { name: event.target.value })} style={{ flex: "1 1 200px" }} />
              <label style={{ fontSize: 12 }}>Min <input className="cf-input" aria-label="Minimum choices" type="number" min="0" value={group.min_select} onChange={(event) => updateGroup(groupIndex, { min_select: event.target.value })} style={{ width: 70 }} /></label>
              <label style={{ fontSize: 12 }}>Max <input className="cf-input" aria-label="Maximum choices" type="number" min="0" value={group.max_select} onChange={(event) => updateGroup(groupIndex, { max_select: event.target.value })} style={{ width: 70 }} /></label>
              <button type="button" className="cf-btn cf-btn--secondary" onClick={() => update({ modifier_groups: value.modifier_groups.filter((_, index) => index !== groupIndex) })}>Remove group</button>
            </div>
            {group.options.map((option, optionIndex) => (
              <div key={optionIndex} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <input className="cf-input" aria-label="Option name" placeholder="Option" value={option.name} onChange={(event) => updateOption(groupIndex, optionIndex, { name: event.target.value })} style={{ flex: "1 1 140px" }} />
                <input className="cf-input" aria-label="Option extra price" type="number" min="0" step="0.01" placeholder="+ price" value={option.price} onChange={(event) => updateOption(groupIndex, optionIndex, { price: event.target.value })} style={{ width: 100 }} />
                <select className="cf-select" aria-label="Linked product" value={option.linked_product_id} onChange={(event) => updateOption(groupIndex, optionIndex, { linked_product_id: event.target.value })} style={{ flex: "1 1 140px" }}>
                  <option value="">No linked product</option>
                  {selectable.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <button type="button" className="cf-btn cf-btn--secondary" onClick={() => updateGroup(groupIndex, { options: group.options.filter((_, index) => index !== optionIndex) })}>×</button>
              </div>
            ))}
            <button type="button" className="cf-btn cf-btn--secondary" style={{ marginTop: 8 }} onClick={() => updateGroup(groupIndex, { options: [...group.options, emptyOption()] })}>Add option</button>
          </div>
        ))}
        <button type="button" className="cf-btn cf-btn--secondary" onClick={() => update({ modifier_groups: [...value.modifier_groups, emptyGroup()] })}>Add choice group</button>
      </div>
    </>
  );
};
