import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { Bills } from './Bills';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
let mockOutlet = '', mockRole = 'Owner';
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'actor', role: mockRole } }) }));
jest.mock('../contexts/UiContext', () => ({ useUi: () => ({ settings: { currency: 'INR' } }) }));
jest.mock('../core/outlets/store/ActiveOutletContext', () => ({ useActiveOutlet: () => ({ selectedOutletId: mockOutlet }) }));
jest.mock('../components/Layout', () => ({ Layout: ({ children }) => <main>{children}</main> }));
jest.mock('../components/ui/dialog', () => ({ Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null }));
jest.mock('../core/outlets/components/OutletOverviewPanel', () => ({ OutletOverviewPanel: () => <p>Choose an outlet</p> }));
jest.mock('../core/billing/components/StockReversal', () => ({ StockReversal: () => null }));
jest.mock('../core/billing/components/BillPayments', () => ({ BillPayments: () => null }));
jest.mock('../hooks/useAutoRefresh', () => ({ useAutoRefresh: (callback, { enabled, refreshKey }) => {
  require('react').useEffect(() => { if (enabled) callback(); }, [enabled, refreshKey]);
} }));

let root, element;
const reply = (name, more = false) => ({ data: { success: true, data: { items: [{ id: name, invoice_number: name, customer_name: name, items: [], created_at: new Date().toISOString(), total: 10 }], has_more: more } } });
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true; mockOutlet = ''; mockRole = 'Owner'; axios.get.mockReset();
  element = document.createElement('div'); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); });
test('all outlets asks for an outlet without a permanent loading screen', async () => {
  await act(async () => root.render(<Bills />));
  expect(element.textContent).toContain('Choose an outlet'); expect(axios.get).not.toHaveBeenCalled();
});
test('late history from the previous outlet cannot replace the selected outlet', async () => {
  let resolveOld; mockOutlet = 'old';
  axios.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(reply('NEW-INVOICE'));
  await act(async () => root.render(<Bills />));
  mockOutlet = 'new'; await act(async () => root.render(<Bills />));
  await act(async () => resolveOld(reply('OLD-INVOICE')));
  expect(element.textContent).toContain('NEW-INVOICE'); expect(element.textContent).not.toContain('OLD-INVOICE');
});
test('history pages at the API and a failed read offers retry without claiming an empty history', async () => {
  mockOutlet = 'outlet'; axios.get.mockResolvedValueOnce(reply('FIRST', true)).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(reply('SECOND'));
  await act(async () => root.render(<Bills />));
  await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === 'Next').click());
  expect(axios.get.mock.calls[1][1].params).toMatchObject({ paged: true, page: 2, outlet_id: 'outlet' });
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
  expect(element.textContent).not.toContain('No bills');
  await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === 'Retry history').click());
  expect(element.textContent).toContain('SECOND'); expect(element.querySelector('[role="alert"]')).toBeNull();
});
