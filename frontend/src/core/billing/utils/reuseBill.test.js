import { cartFromBill, configuredPrice } from './reuseBill';
const product = { id: 'sku', name: 'Meal', price: 80, stock: 10, variation_options: [{ name: 'Large', price: 20 }], addon_options: [{ name: 'Cheese', price: 5 }], modifier_groups: [{ options: [{ id: 'extra', price: 2 }] }] };
const options = { keyFor: id => id, availability: () => ({}), modifierProblem: () => '', removalOptions: () => ['Onion'] };
test('reused bill items use current menu prices and do not carry invoice/payment/reservation identity', () => {
  const bill = { id: 'old', table_id: 'old-table', reservation_id: 'old-reservation', customer_name: 'Old guest', payment_type: 'Cash', items: [{ id: 'sku', name: 'Old name', price: 1, quantity: 2, variation: 'Large', addons: ['Cheese'], modifiers: { options: [{ option_id: 'extra' }] } }] };
  const cart = cartFromBill(bill, [product], options);
  expect(cart.sku.unitPrice).toBe(107);
  expect(cart.sku.quantity).toBe(2);
  expect(cart.sku.product).toBe(product);
  expect(cart.sku).not.toHaveProperty('payment_type');
  expect(cart.sku).not.toHaveProperty('reservation_id');
  expect(bill.items[0].price).toBe(1);
});
test.each([
  { items: [{ id: 'deleted', quantity: 1 }] },
  { items: [{ id: 'sku', quantity: 11 }] },
  { items: [{ id: 'sku', quantity: 1, addons: ['Removed option'] }] },
  { items: [{ id: 'sku', quantity: 1, modifiers: { options: [{ option_id: 'unknown' }] } }] },
  { items: [] },
])('unavailable or changed items cannot silently become invented custom products', bill => {
  expect(() => cartFromBill(bill, [product], options)).toThrow();
});
test('explicit zero current prices remain zero', () => {
  expect(configuredPrice({ price: 0 }, '')).toBe(0);
  expect(cartFromBill({ items: [{ id: 'sku', quantity: 1 }] }, [{ ...product, price: 0 }], options).sku.unitPrice).toBe(0);
});
