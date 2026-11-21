export function configuredPrice(product, variation, addons = [], modifiers = []) {
  return Number(product.price ?? 0)
    + Number((product.variation_options || []).find(option => option.name === variation)?.price ?? 0)
    + (product.addon_options || []).filter(option => addons.includes(option.name)).reduce((sum, option) => sum + Number(option.price ?? 0), 0)
    + (product.modifier_groups || []).flatMap(group => group.options || []).filter(option => modifiers.includes(option.id)).reduce((sum, option) => sum + Number(option.price ?? 0), 0);
}

// Copy items only. Invoice identity, customer, payment, table and reservations
// deliberately stay outside the returned cart. Current menu pricing is used.
export function cartFromBill(bill, products, { keyFor, availability, modifierProblem, removalOptions }) {
  if (!Array.isArray(bill.items) || !bill.items.length) throw new Error('This bill has no items to reuse.');
  const cart = {};
  for (const item of bill.items) {
    const product = products.find(row => row.id === (item.product_id || item.productId || item.id));
    if (!product || product.active === false) throw new Error(`${item.name || 'An item'} is no longer available in this menu.`);
    const variation = item.variation || '', addons = item.addons || [], removals = item.removed_ingredients || [];
    const modifiers = (item.modifiers?.options || []).map(option => option.option_id).filter(Boolean);
    if (variation && !(product.variation_options || []).some(option => option.name === variation)) throw new Error(`Review the changed variation for ${product.name}.`);
    if (addons.some(name => !(product.addon_options || []).some(option => option.name === name)) ||
      removals.some(name => !removalOptions(product).includes(name)) ||
      modifiers.some(id => !(product.modifier_groups || []).some(group => (group.options || []).some(option => option.id === id)))) throw new Error(`Review the changed options for ${product.name}.`);
    const problem = modifierProblem(product, modifiers) || availability(product, variation, addons, removals).blockedReason;
    if (problem) throw new Error(problem);
    const quantity = Number(item.quantity);
    const customNote = item.custom_note || '';
    const key = keyFor(product.id, variation, addons, removals, customNote, modifiers);
    const nextQuantity = (cart[key]?.quantity || 0) + quantity;
    if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(Number(product.stock)) || nextQuantity > Number(product.stock)) throw new Error(`Review the available quantity for ${product.name}.`);
    const chosenOptions = (product.modifier_groups || []).flatMap(group => group.options || []).filter(option => modifiers.includes(option.id));
    const displayName = [product.name, variation, chosenOptions.length ? `(${chosenOptions.map(option => option.name).join(', ')})` : '',
      addons.length ? `+ ${addons.join(', ')}` : '', removals.join(', '), customNote.trim()].filter(Boolean).join(' ');
    cart[key] = { key, product, quantity: nextQuantity, unitPrice: configuredPrice(product, variation, addons, modifiers),
      variation, addons, removals, customNote, modifiers, displayName };
  }
  const quantities = {};
  for (const entry of Object.values(cart)) {
    quantities[entry.product.id] = (quantities[entry.product.id] || 0) + entry.quantity;
    if (quantities[entry.product.id] > Number(entry.product.stock)) throw new Error(`Review the available quantity for ${entry.product.name}.`);
  }
  return cart;
}
