import React from "react";

export function QrProductDetails({ value = {}, onChange }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  const list = (key, label) => (
    <label className="cf-field">{label}
      <input className="cf-input" value={(value[key] || []).join(",")} maxLength={1000}
        placeholder="For example: Milk, Wheat, Nuts"
        onChange={(event) => set(key, event.target.value.split(","))} />
    </label>
  );
  return <fieldset className="cf-card" style={{ padding: 16 }}>
    <legend>Customer QR menu details</legend>
    <label className="cf-field">Menu description
      <textarea className="cf-textarea" maxLength={500} rows={2} value={value.description || ""} onChange={(event) => set("description", event.target.value)} />
    </label>
    {list("allergens", "Contains allergens (comma separated)")}
    {list("may_contain", "May contain / shared equipment (comma separated)")}
    <label><input type="checkbox" checked={value.allergens_reviewed === true} onChange={(event) => set("allergens_reviewed", event.target.checked)} /> Dish and kitchen cross-contact information reviewed by the restaurant</label>
    <p className="cf-card__meta">Ingredient warnings are automatically included from Inventory → Ingredient allergens through recipes, variations, add-ons and combos. Add any extra dish-level warnings here. The menu stays unconfirmed while any recipe ingredient or linked product is unreviewed. Optional customisation warnings are included conservatively.</p>
    <div><label><input type="checkbox" checked={value.enabled !== false} onChange={(event) => set("enabled", event.target.checked)} /> Show on the QR menu</label></div>
    <div><label><input type="checkbox" checked={value.sold_out === true} onChange={(event) => set("sold_out", event.target.checked)} /> Temporarily sold out (keep visible, stop QR orders)</label></div>
    <div><label><input type="checkbox" checked={value.enforce_stock === true} onChange={(event) => set("enforce_stock", event.target.checked)} /> Limit QR quantity to recorded product stock</label></div>
    <p className="cf-card__meta">Use the stock limit for counted items. Leave it off for dishes made to order. Stock is checked when an order is submitted; pending orders do not reserve stock.</p>
  </fieldset>;
}

export const normalizeQrDetails = (value = {}) => ({
  ...value,
  allergens: [...new Set((value.allergens || []).map((item) => item.trim()).filter(Boolean))],
  may_contain: [...new Set((value.may_contain || []).map((item) => item.trim()).filter(Boolean))],
});
