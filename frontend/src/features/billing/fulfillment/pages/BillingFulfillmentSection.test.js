import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BillingFulfillmentSection } from './BillingFulfillmentSection';
import { createInitialOrderMeta } from '../utils/fulfillmentMode';
jest.mock('../components/FulfillmentDetailsFields', () => ({ FulfillmentDetailsFields: ({ hasServiceChoice }) => <div data-testid="details">{hasServiceChoice ? 'Choose service' : 'Order details'}</div> }));
jest.mock('../components/FulfillmentTablePanel', () => ({ FulfillmentTablePanel: () => <div data-testid="tables">Select a table</div> }));
let element, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; element = document.createElement('div'); root = createRoot(element); });
afterEach(async () => { await act(async () => root.unmount()); });
test.each(['TABLE', 'TOKEN', 'PICKUP', 'DELIVERY'])('single %s service has no selector or duplicate service card', async mode => {
  await act(async () => root.render(<BillingFulfillmentSection orderMeta={{ ...createInitialOrderMeta(), fulfillment_mode: mode }} allowedModes={{ [mode]: true }} />));
  expect(element.querySelector('[aria-label="Order service"]')).toBeNull();
  expect(element.querySelector('[data-testid="details"]').textContent).toBe('Order details');
  expect(element.textContent).not.toMatch(/Counter handover|Pickup Handover|Delivery Dispatch|AdminCore/);
});
test('no configured services exposes no order fields or table controls', async () => {
  await act(async () => root.render(<BillingFulfillmentSection orderMeta={createInitialOrderMeta()} allowedModes={{}} />));
  expect(element.querySelector('[role="alert"]').textContent).toContain('unavailable');
  expect(element.querySelector('[data-testid="details"]')).toBeNull();
  expect(element.querySelector('[data-testid="tables"]')).toBeNull();
});
test('an existing cart needs explicit review instead of silently changing its service', async () => {
  const change = jest.fn();
  await act(async () => root.render(<BillingFulfillmentSection orderMeta={createInitialOrderMeta()} allowedModes={{ DELIVERY: true }} hasCartItems changeFulfillmentMode={change} />));
  expect(change).not.toHaveBeenCalled();
  expect(element.querySelector('[data-testid="tables"]')).toBeNull();
  await act(async () => element.querySelector('button').click());
  expect(change).toHaveBeenCalledWith('DELIVERY');
});
