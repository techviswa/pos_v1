import React from "react";

export function QrFoodInformation({ item }) {
  return <div className="cf-card__meta">
    {item.allergens?.length ? <p><strong>Contains:</strong> {item.allergens.join(", ")}</p> : null}
    {item.may_contain?.length ? <p><strong>May contain:</strong> {item.may_contain.join(", ")}</p> : null}
    {!item.allergens_reviewed ? <p>Allergen information not confirmed. Please ask staff.</p> :
      !item.allergens?.length && !item.may_contain?.length ? <p>No allergens listed by the restaurant. Please confirm with staff if you have an allergy.</p> : null}
    {item.recipe_ingredients > 0 ? <p>Includes recipe and optional customisation warnings.{item.unreviewed_ingredients > 0 ? " Some ingredient information still needs review." : ""} Please discuss allergies with staff.</p> : null}
    {item.qr_availability?.available === false ? <strong role="status">{item.qr_availability.reason || "Unavailable"}</strong> : null}
  </div>;
}
