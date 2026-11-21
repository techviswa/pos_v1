import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { Billing } from './Billing';
import { useActiveOutlet } from '../core/outlets/store/ActiveOutletContext';

jest.mock('axios', () => ({ get: jest.fn() }));
let mockLocation = { pathname: '/billing', state: null };
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation, useNavigate: () => mockNavigate, Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }));
jest.mock('../lib/liveUpdates', () => ({ subscribeLiveUpdates: () => () => {} }));
let mockRole = 'Owner';
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor', role: mockRole, business_id: 'business' } }) }));
jest.mock('../contexts/UiContext', () => ({ useUi: () => ({ settings: {
  paymentMethods: ['Cash'], currency: 'INR', taxRate: 18, shopName: 'Restaurant',
} }) }));
jest.mock('../core/outlets/store/ActiveOutletContext', () => ({ useActiveOutlet: jest.fn() }));
jest.mock('../components/Layout', () => ({ Layout: ({ children }) => <div className="cf-shell"><header className="cf-topbar">Billing</header><div className="cf-shell__body"><main className="cf-main cf-main--billing">{children}</main></div></div> }));
jest.mock('../components/ui/dialog', () => ({ Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null }));
jest.mock('../core/outlets/components/OutletOverviewPanel', () => ({ OutletOverviewPanel: () => <div>Pick an outlet</div> }));
jest.mock('../core/payments/RazorpayCollect', () => ({ RazorpayCollect: () => null }));
jest.mock('../core/offline/offlineQueue', () => ({ applyUnsyncedStock: rows => rows }));
jest.mock('../lib/offlineCache', () => ({ loadOfflineData: () => null, saveOfflineData: jest.fn(), setOfflineScope: jest.fn() }));
jest.mock('../features/billing/fulfillment/services/fulfillment.service', () => ({ fulfillmentService: {
  fetchTableManagement: () => Promise.resolve({ tables: { items: [{ id: 't', name: 'Main Table' }] }, reservations: { items: [] } }),
} }));
jest.mock('../features/billing/fulfillment/pages/BillingFulfillmentSection', () => ({ BillingFulfillmentSection: ({ tableItems, changeFulfillmentMode }) => <div>
  {tableItems.map(table => <span key={table.id}>{table.name}</span>)}
  <button data-testid="takeaway" onClick={() => changeFulfillmentMode('TOKEN')}>Takeaway</button>
</div> }));

const product = name => ({ id: name, name, category: 'Drinks', stock: 10, price: 20, active: true, variations: [], addons: [] });
const productCalls = () => axios.get.mock.calls.filter(([url]) => url.endsWith('/api/products'));
let root, element, outlet;
beforeEach(() => {
  mockLocation = { pathname: '/billing', state: null }; mockNavigate.mockClear();
  mockRole = 'Owner';
  global.IS_REACT_ACT_ENVIRONMENT = true;
  outlet = { selectedOutletId: '', selectedOutlet: null };
  useActiveOutlet.mockImplementation(() => outlet);
  axios.get.mockReset();
  axios.get.mockImplementation((url, options) => {
    if (url.endsWith('/api/billing/fulfillment-modes')) return Promise.resolve({ data: { TABLE: true, TOKEN: true, PICKUP: true, DELIVERY: true } });
    if (url.endsWith('/api/products')) return Promise.resolve({ data: [product(`${options.params.outlet_id} coffee`)] });
    if (url.endsWith('/api/inventory')) return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: [] });
  });
  element = document.createElement('div');
  root = createRoot(element);
});

test('linked historical items populate a new cart at the current menu price', async () => {
  outlet = { selectedOutletId: 'main', selectedOutlet: { id: 'main', name: 'Main' } };
  mockLocation = { pathname: '/billing', state: { repeatBillId: 'old-invoice', repeatOutletId: 'main' } };
  const originalGet = axios.get.getMockImplementation();
  axios.get.mockImplementation((url, options) => url.endsWith('/api/billing/old-invoice')
    ? Promise.resolve({ data: { outlet_id: 'main', items: [{ id: 'line', productId: 'main coffee', quantity: 2, price: 1 }] } })
    : originalGet(url, options));
  await act(async () => root.render(<Billing />));
  const reuse = [...element.querySelectorAll('button')].find(button => button.textContent === 'Use items for this sale');
  expect(reuse.disabled).toBe(false);
  await act(async () => reuse.click());
  expect(element.querySelector('.cf-cart__item-name').textContent).toContain('main coffee');
  expect(element.querySelector('.cf-cart__qty-num').textContent).toBe('2');
  expect(element.querySelector('.cf-cart__item-total').textContent).toContain('40.00');
  expect(mockNavigate).toHaveBeenCalledWith('/billing', { replace: true, state: null });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('selecting the first outlet populates products and tables without leaving Billing', async () => {
  await act(async () => root.render(<Billing />));
  expect(element.textContent).toContain('Pick an outlet');
  expect(productCalls()).toHaveLength(0);
  outlet = { selectedOutletId: 'main', selectedOutlet: { id: 'main', name: 'Main Outlet' } };
  await act(async () => root.render(<Billing />));
  expect(productCalls()).toHaveLength(1);
  expect(element.textContent).toContain('main coffee');
  expect(element.textContent).toContain('Main Table');
  await act(async () => element.querySelector('[data-testid="takeaway"]').click());
  expect(productCalls()).toHaveLength(2);
  expect(productCalls()[1][1].params).toEqual({ channel: 'Takeaway', outlet_id: 'main' });
});

test('a late response from the old outlet cannot overwrite the newly selected menu', async () => {
  let finishOld;
  const original = axios.get.getMockImplementation();
  axios.get.mockImplementation((url, options) => url.endsWith('/api/products') && options.params.outlet_id === 'old'
    ? new Promise(resolve => { finishOld = resolve; }) : original(url, options));
  outlet = { selectedOutletId: 'old', selectedOutlet: { id: 'old', name: 'Old Outlet' } };
  await act(async () => root.render(<Billing />));
  outlet = { selectedOutletId: 'new', selectedOutlet: { id: 'new', name: 'New Outlet' } };
  await act(async () => root.render(<Billing />));
  expect(element.textContent).toContain('new coffee');
  await act(async () => finishOld({ data: [product('old coffee')] }));
  expect(element.textContent).toContain('new coffee');
  expect(element.textContent).not.toContain('old coffee');
  expect(productCalls()).toHaveLength(2);
});

test('a new order automatically uses the only supplied service', async () => {
  const original = axios.get.getMockImplementation();
  axios.get.mockImplementation((url, options) => url.endsWith('/api/billing/fulfillment-modes')
    ? Promise.resolve({ data: { TABLE: false, TOKEN: true, PICKUP: false, DELIVERY: false } }) : original(url, options));
  outlet = { selectedOutletId: 'main', selectedOutlet: { id: 'main', name: 'Main Outlet' } };
  await act(async () => root.render(<Billing />));
  expect(productCalls().at(-1)[1].params.channel).toBe('Takeaway');
  expect(element.textContent).toContain('main coffee');
});

test.each(['Owner', 'Waiter'])('%s reads billing stock without inventory management access and cannot bill an empty cart', async role => {
  mockRole = role;
  const original = axios.get.getMockImplementation();
  axios.get.mockImplementation((url, options) => {
    if (url.endsWith('/api/products')) return Promise.resolve({ data: [{ ...product('Rice'), category: 'Meals', recipe_lines: [{ inventory_id: 'rice', ingredient_name: 'Rice', quantity: 1 }] }] });
    if (url.endsWith('/api/billing/ingredient-stock')) return Promise.resolve({ data: [{ id: 'rice', name: 'Rice', current_stock: 20 }] });
    return original(url, options);
  });
  outlet = { selectedOutletId: 'main', selectedOutlet: { id: 'main', name: 'Main Outlet' } };
  await act(async () => root.render(<Billing />));
  expect(element.textContent).not.toContain('Low ingredients');
  expect(axios.get.mock.calls.some(([url]) => url.endsWith('/api/inventory') || url.endsWith('/main/inventory'))).toBe(false);
  const checkout = element.querySelector('.cf-cart__checkout button');
  expect(checkout.disabled).toBe(true);
  expect([...element.querySelectorAll('.cf-cart__options')].every(node => !node.open)).toBe(true);
  await act(async () => element.querySelector('[data-testid="product-card-Rice"]').click());
  expect(checkout.disabled).toBe(false);
});

test('unavailable ingredient data is not displayed as a stock shortage', async () => {
  const original = axios.get.getMockImplementation();
  axios.get.mockImplementation((url, options) => url.endsWith('/api/billing/ingredient-stock') ? Promise.reject(new Error('Unavailable')) : original(url, options));
  outlet = { selectedOutletId: 'main', selectedOutlet: { id: 'main', name: 'Main Outlet' } };
  await act(async () => root.render(<Billing />));
  expect(element.textContent).toContain('Ingredient availability is not verified');
  expect(element.textContent).not.toContain('Low ingredients');
});

test('cart items and checkout remain separate from scrollable adjustments', async () => {
  const original = axios.get.getMockImplementation();
  axios.get.mockImplementation((url, options) => url.endsWith('/api/products')
    ? Promise.resolve({ data: [{ ...product('Rice'), category: 'Meals' }] }) : original(url, options));
  outlet = { selectedOutletId: 'main', selectedOutlet: { id: 'main', name: 'Main Outlet' } };
  await act(async () => root.render(<Billing />));
  const card = element.querySelector('[data-testid^="product-card-"]');
  expect(card).not.toBeNull();
  await act(async () => card.click());
  expect(element.querySelector('.cf-cart__body [data-testid^="cart-item-"]')).not.toBeNull();
  expect(element.querySelector('.cf-cart__checkout #cart-total').textContent).toContain('23.60');
  expect(element.querySelector('.cf-cart__checkout #cart-payment')).not.toBeNull();
  if (process.env.POS_LAYOUT_FIXTURE) {
    const fs = require('fs');
    const css = fs.readFileSync(require('path').join(__dirname, '../App.css'), 'utf8');
    fs.writeFileSync(process.env.POS_LAYOUT_FIXTURE, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0} ${css}</style></head><body>${element.innerHTML}</body></html>`);
  }
});
