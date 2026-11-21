import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ProductPhoto } from "./ProductPhoto";
import { QrFoodInformation } from "./QrFoodInformation";
import { formatCurrency } from "../lib/pos";
import "./QrItemSheet.css";

export function QrItemSheet({ item, selection, price, problem, remaining, onSelection, onAddon, onModifier, onAdd, onClose }) {
  const [quantity, setQuantity] = useState(1);
  const unavailable = item.qr_availability?.available === false || remaining <= 0;
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="cf-qr-item-overlay" />
    <Dialog.Content className="cf-qr-item-sheet">
      <Dialog.Close className="cf-qr-item-sheet__close" aria-label="Close item details">×</Dialog.Close>
      <header className="cf-qr-item-sheet__header">
        <ProductPhoto source={item.image_url} name={item.name} size={88} />
        <div><Dialog.Title>{item.name}</Dialog.Title><Dialog.Description>{item.description || "Choose your preferences before adding to your order."}</Dialog.Description></div>
      </header>
      <div className="cf-qr-item-sheet__body">
        {item.variation_options?.length ? <fieldset><legend>Size</legend><select className="cf-select" aria-label={`Size for ${item.name}`} value={selection.variationId || ""} onChange={(event) => onSelection({ variationId: event.target.value || null })}>
          <option value="">Regular</option>{item.variation_options.map((option) => <option key={option.id} value={option.id}>{option.name}{Number(option.price) ? ` + ${formatCurrency(option.price)}` : ""}</option>)}
        </select></fieldset> : null}
        {(item.modifier_groups || []).map((group) => {
          const single = Number(group.max_select) === 1, chosen = selection.modifierIds || [];
          const inGroup = (group.options || []).filter((option) => chosen.includes(option.id)).length, max = Number(group.max_select || 0);
          return <fieldset key={group.id}><legend>{group.name} <small>{Number(group.min_select) ? "Required" : "Optional"}{!single && max ? ` · up to ${max}` : ""}</small></legend>
            <div className="cf-qr-item-sheet__choices">
              {single && !Number(group.min_select) ? <label><input type="radio" name={`sheet-${group.id}`} checked={!inGroup} onChange={() => onSelection({ modifierIds: chosen.filter((id) => !(group.options || []).some((option) => option.id === id)) })} />None</label> : null}
              {(group.options || []).filter((option) => option.active !== false).map((option) => <label key={option.id}><input type={single ? "radio" : "checkbox"} name={`sheet-${group.id}`} checked={chosen.includes(option.id)} disabled={!single && !chosen.includes(option.id) && max > 0 && inGroup >= max} onChange={() => onModifier(group, option.id)} />{option.name}<span>{Number(option.price) ? `+ ${formatCurrency(option.price)}` : "Included"}</span></label>)}
            </div>
          </fieldset>;
        })}
        {item.addon_options?.length ? <fieldset><legend>Extras <small>Optional</small></legend><div className="cf-qr-item-sheet__choices">{item.addon_options.map((addon) => <label key={addon.id}><input type="checkbox" checked={(selection.addonIds || []).includes(addon.id)} onChange={() => onAddon(addon.id)} />{addon.name}<span>{Number(addon.price) ? `+ ${formatCurrency(addon.price)}` : "Included"}</span></label>)}</div></fieldset> : null}
        <details className="cf-qr-item-sheet__disclosure"><summary>Allergens & food information</summary><QrFoodInformation item={item} /><p>Removing an ingredient does not guarantee an allergen-free dish. Please confirm allergies with staff.</p></details>
        <details className="cf-qr-item-sheet__disclosure"><summary>Add a kitchen request <small>Optional</small></summary><label className="cf-field">Request for {item.name}<textarea className="cf-textarea" maxLength={200} rows={2} placeholder="For example: less spicy" value={selection.kitchenNote || ""} onChange={(event) => onSelection({ kitchenNote: event.target.value })} /></label><p>Subject to restaurant confirmation.</p></details>
      </div>
      <footer className="cf-qr-item-sheet__footer">
        {problem ? <p role="status">{problem}</p> : null}
        {unavailable ? <p role="status">This item is currently unavailable.</p> : null}
        <div><div className="cf-qr-qty-control"><button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>−</button><b aria-live="polite">{quantity}</b><button type="button" aria-label="Increase quantity" disabled={quantity >= remaining} onClick={() => setQuantity(quantity + 1)}>+</button></div>
          <button className="cf-btn cf-btn--primary" type="button" disabled={unavailable || Boolean(problem) || quantity > remaining} onClick={() => onAdd(quantity)}>Add to order · {formatCurrency(price * quantity)}</button></div>
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
