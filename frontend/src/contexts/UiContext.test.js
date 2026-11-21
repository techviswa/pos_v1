import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { UiProvider, useUi } from './UiContext';
import { useAuth } from './AuthContext';
jest.mock('axios', () => ({ get: jest.fn(), put: jest.fn() }));
jest.mock('./AuthContext', () => ({ API_URL: 'http://test', useAuth: jest.fn() }));
jest.mock('../lib/liveUpdates', () => ({ subscribeLiveUpdates: () => () => {} }));
const profile = (name, business_id = 'a') => ({ shopName: name, business_id, tenant_id: business_id, updated_at: '2026-11-01T00:00:00.000Z', paymentMethods: ['Cash'] });
function View() {
  const { settings, updateSettings, profileError } = useUi();
  return <><span>{settings.shopName}</span><span>{profileError}</span><button onClick={() => updateSettings({ shopName: 'Saved shop' })}>Save</button></>;
}
let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); localStorage.clear(); useAuth.mockReturnValue({ user: { business_id: 'a' } }); element = document.createElement('div'); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); });
test('loads authoritative name, waits for save confirmation and stores only business-scoped copies', async () => {
  localStorage.setItem('cashflow-lite-ui-settings', JSON.stringify({ shopName: 'Other business legacy name' }));
  axios.get.mockResolvedValue({ data: { success: true, data: profile('Actual shop') } });
  let confirm;
  axios.put.mockReturnValue(new Promise(resolve => { confirm = resolve; }));
  await act(async () => root.render(<UiProvider><View /></UiProvider>));
  expect(element.textContent).toContain('Actual shop');
  expect(element.textContent).not.toContain('Other business legacy name');
  await act(async () => element.querySelector('button').click());
  expect(element.textContent).toContain('Actual shop');
  expect(axios.put.mock.calls[0][1].expected_updated_at).toBe(profile('').updated_at);
  await act(async () => { confirm({ data: profile('Saved shop') }); });
  expect(element.textContent).toContain('Saved shop');
  expect(JSON.parse(localStorage.getItem('cashflow-lite-business-profile:a')).shopName).toBe('Saved shop');
});
test('late responses cannot leak a previous business name after switching accounts', async () => {
  let finish;
  axios.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ data: profile('Business B', 'b') });
  await act(async () => root.render(<UiProvider><View /></UiProvider>));
  useAuth.mockReturnValue({ user: { business_id: 'b' } });
  await act(async () => root.render(<UiProvider><View /></UiProvider>));
  expect(element.textContent).toContain('Business B');
  await act(async () => { finish({ data: profile('Private A') }); });
  expect(element.textContent).not.toContain('Private A');
});
test('a failed read is an explicit error, without importing unscoped browser defaults', async () => {
  axios.get.mockRejectedValue(new Error('offline'));
  await act(async () => root.render(<UiProvider><View /></UiProvider>));
  expect(element.textContent).toContain('could not be refreshed');
  expect(element.textContent).not.toContain('CashFlow Lite');
});
test('a late save from the previous account cannot cancel the new business read', async () => {
  axios.get.mockResolvedValueOnce({ data: profile('Business A') });
  let finishSave, finishRead;
  axios.put.mockReturnValue(new Promise(resolve => { finishSave = resolve; }));
  await act(async () => root.render(<UiProvider><View /></UiProvider>));
  await act(async () => element.querySelector('button').click());
  useAuth.mockReturnValue({ user: { business_id: 'b' } });
  axios.get.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
  await act(async () => root.render(<UiProvider><View /></UiProvider>));
  await act(async () => { finishSave({ data: profile('Private A save') }); });
  await act(async () => { finishRead({ data: profile('Business B', 'b') }); });
  expect(element.textContent).toContain('Business B');
  expect(element.textContent).not.toContain('Private A');
});
test('an older save response cannot replace a newer confirmed refresh or offline copy', async () => {
  axios.get.mockResolvedValueOnce({ data: profile('Initial shop') });
  let finishSave;
  axios.put.mockReturnValue(new Promise(resolve => { finishSave = resolve; }));
  await act(async () => root.render(<UiProvider><View /></UiProvider>));
  await act(async () => element.querySelector('button').click());
  axios.get.mockResolvedValue({ data: { ...profile('Newer shop'), updated_at: '2026-11-01T02:00:00.000Z' } });
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => { finishSave({ data: { ...profile('Older shop'), updated_at: '2026-11-01T01:00:00.000Z' } }); });
  expect(element.textContent).toContain('Newer shop');
  expect(JSON.parse(localStorage.getItem('cashflow-lite-business-profile:a')).shopName).toBe('Newer shop');
});
