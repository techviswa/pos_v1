import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Settings } from './Settings';
import { useUi } from '../contexts/UiContext';
import { fulfillmentService } from '../features/billing/fulfillment/services/fulfillment.service';
import { DEFAULT_UI_SETTINGS } from '../lib/pos';
import { toast } from 'sonner';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
jest.mock('../components/Layout', () => ({ Layout: ({ children }) => <div>{children}</div> }));
jest.mock('../contexts/UiContext', () => ({ useUi: jest.fn() }));
jest.mock('../contexts/AuthContext', () => ({ API_URL: '', useAuth: jest.fn() }));
jest.mock('axios', () => ({ put: jest.fn(), post: jest.fn() }));
jest.mock('../core/payments/PaymentGatewaySettings', () => ({ PaymentGatewaySettings: () => null }));
jest.mock('../features/billing/fulfillment/services/fulfillment.service', () => ({ fulfillmentService: { fetchSettings: jest.fn(), updateSettings: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
let root, element, context, account;
const button = text => [...element.querySelectorAll('button')].find(node => node.textContent.trim() === text);
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  localStorage.clear();
  account = { user: { id: 'owner-fixture', business_id: 'a', role: 'Owner', name: 'Actual cashier', email: 'actual@example.test' }, applyProfile: jest.fn() };
  useAuth.mockReturnValue(account);
  element = document.createElement('div'); root = createRoot(element);
  context = { settings: { ...DEFAULT_UI_SETTINGS, shopName: 'Saved shop', updated_at: 'version-one', persisted: true }, profileLoaded: true,
    updateSettings: jest.fn(), refreshProfile: jest.fn() };
  useUi.mockImplementation(() => context);
  fulfillmentService.fetchSettings.mockResolvedValue({});
});
afterEach(async () => { await act(async () => root.unmount()); });
const editName = async value => {
  const input = [...element.querySelectorAll('input')].find(node => node.value === 'Saved shop');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
test('background refresh preserves the draft and its original source revision', async () => {
  await act(async () => root.render(<Settings />));
  await editName('My draft');
  context = { ...context, settings: { ...context.settings, shopName: 'Other editor', updated_at: 'version-two' } };
  await act(async () => root.render(<Settings />));
  expect([...element.querySelectorAll('input')].some(input => input.value === 'My draft')).toBe(true);
  context.updateSettings.mockRejectedValue(new Error('Changed elsewhere'));
  await act(async () => button('Save Changes').click());
  expect(context.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ shopName: 'My draft' }), 'version-one');
  expect(toast.success).not.toHaveBeenCalled();
  expect(fulfillmentService.updateSettings).not.toHaveBeenCalled();
});
test('failed table reads block defaults from being saved and provide retry', async () => {
  fulfillmentService.fetchSettings.mockRejectedValueOnce(new Error('Unavailable'));
  await act(async () => root.render(<Settings />));
  expect(button('Save Changes').disabled).toBe(true);
  expect(element.querySelector('[role="alert"]').textContent).toContain('protect existing settings');
  await act(async () => button('Retry table preferences').click());
  expect(button('Save Changes').disabled).toBe(false);
});
test('partial save reports that shop details succeeded but table preferences failed', async () => {
  context.updateSettings.mockResolvedValue(context.settings);
  fulfillmentService.updateSettings.mockRejectedValue(new Error('Table service unavailable'));
  await act(async () => root.render(<Settings />));
  await act(async () => button('Save Changes').click());
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Shop details saved, but table preferences failed'));
  expect(toast.success).not.toHaveBeenCalled();
});
test('account fields show the real user and name saves through the personal profile API', async () => {
  await act(async () => root.render(<Settings />));
  const email = element.querySelector('input[type="email"]');
  expect(email.value).toBe('actual@example.test');
  expect(email.readOnly).toBe(true);
  const input = [...element.querySelectorAll('input')].find(node => node.value === 'Actual cashier');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Updated cashier');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const saved = { ...account.user, name: 'Updated cashier' };
  axios.put.mockResolvedValue({ data: { success: true, data: saved } });
  await act(async () => button('Save account name').click());
  expect(axios.put).toHaveBeenCalledWith('/api/staff/me/profile', { name: 'Updated cashier' }, { withCredentials: true });
  expect(account.applyProfile).toHaveBeenCalledWith(saved);
  expect(context.updateSettings).not.toHaveBeenCalled();
});
test('a failed account save keeps the draft and does not update session identity', async () => {
  await act(async () => root.render(<Settings />));
  const input = [...element.querySelectorAll('input')].find(node => node.value === 'Actual cashier');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Unsaved account');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  axios.put.mockRejectedValue(new Error('Unavailable'));
  await act(async () => button('Save account name').click());
  expect(input.value).toBe('Unsaved account');
  expect(account.applyProfile).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
test('a fresh browser cannot import invented shop details as legacy preferences', async () => {
  context.settings = { ...context.settings, persisted: false, gst: '', address: '', phone: '' };
  await act(async () => root.render(<Settings />));
  expect(button('Review browser preferences for this business')).toBeUndefined();
  expect(element.textContent).not.toContain('29ABCDE1234F1Z5');
});
