import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { CashierSettlement } from './CashierSettlement';
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
let element, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  axios.get.mockReset(); axios.post.mockReset();
  element = document.createElement('div'); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); });
const refresh = async () => act(async () => element.querySelector('button').click());
test('the dedicated drawer workspace loads without requiring a manual refresh', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/history') ? { items: [], pagination: { total: 0 } } : null }));
  await act(async () => root.render(<CashierSettlement initiallyOpen apiUrl="http://api" outletId="main" />));
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(element.textContent).toContain('No open shift');
  expect(element.textContent).toContain('Settlement history');
});
const setCash = async value => act(async () => {
  const input = element.querySelector('input[type="number"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
test('closing requires an explicit review and sends the scoped shift identity', async () => {
  axios.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/current') ? { id: 'shift', status: 'open', opened_by_name: 'Cashier' } : url.endsWith('/history') ? { items: [], pagination: { total: 0, has_more: false } } : { expected_cash: 100 } }));
  axios.post.mockResolvedValue({ data: {} });
  await act(async () => root.render(<CashierSettlement apiUrl="http://api" outletId="main" currency="INR" />));
  await refresh(); await setCash('95');
  const form = element.querySelector('form');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(axios.post).not.toHaveBeenCalled();
  expect(element.textContent).toContain('Variance');
  expect(element.textContent).toContain('Confirm shift closure');
  if (process.env.POS_PANEL_FIXTURES) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('details').forEach(node => { node.open = true; });
    require('fs').writeFileSync(`${process.env.POS_PANEL_FIXTURES}/settlement.html`, clone.innerHTML);
  }
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(axios.post).toHaveBeenCalledWith('http://api/api/billing/shifts/close', { outlet_id: 'main', shift_id: 'shift', closing_cash: 95 }, { withCredentials: true });
});
test('an old outlet response cannot replace the current settlement', async () => {
  let finishOld;
  axios.get.mockImplementation((url, options) => url.endsWith('/current') && options.params.outlet_id === 'old' ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ data: url.endsWith('/history') ? { items: [], pagination: { total: 0 } } : null }));
  await act(async () => root.render(<CashierSettlement apiUrl="http://api" outletId="old" />));
  await refresh();
  await act(async () => root.render(<CashierSettlement apiUrl="http://api" outletId="new" />));
  await refresh();
  await act(async () => finishOld({ data: { id: 'old-shift', status: 'closed', closed_at: '2026-01-01' } }));
  expect(element.textContent).toContain('No open shift');
  expect(element.textContent).not.toContain('Shift closed');
});
