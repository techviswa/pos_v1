import React from "react";
import { formatCurrency } from "../lib/pos";

export const currentQrOffers = (items) => {
  const groups = new Map();
  for (const item of items) {
    if (!item.price_rule?.id || !(Number(item.list_price) > Number(item.price)) || item.qr_availability?.available === false) continue;
    const offer = groups.get(item.price_rule.id) || { id: item.price_rule.id, name: item.price_rule.name, items: 0, saving: 0 };
    offer.items++; offer.saving = Math.max(offer.saving, Math.round((Number(item.list_price) - Number(item.price)) * 100) / 100);
    groups.set(offer.id, offer);
  }
  return [...groups.values()];
};
export function QrOffers({ items, offersOnly, onToggle }) {
  const offers = currentQrOffers(items);
  if (!offers.length && !offersOnly) return null;
  return <section className="cf-qr-success" aria-label="Current menu offers">
    <strong>Offers available now</strong>
    {offers.length ? offers.map((offer) => <span key={offer.id}>{offer.name}: save up to {formatCurrency(offer.saving)} on {offer.items} {offer.items === 1 ? "item" : "items"}.</span>) : <span>No active offers right now. Explore the full menu.</span>}
    <small>Shown prices include the offer on the base item. Sizes and extras cost separately. Offers are rechecked when you order.</small>
    <button type="button" aria-pressed={offersOnly} onClick={onToggle}>{offersOnly ? "Show full menu" : "Show offer items"}</button>
  </section>;
}
