import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FulfillmentModeSelector } from './FulfillmentModeSelector';
test('only AdminCore-enabled modes can be selected', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement('div'), root = createRoot(element), onChange = jest.fn();
  try {
    await act(async () => root.render(<FulfillmentModeSelector value="TABLE" onChange={onChange} allowedModes={{ TABLE: false, TOKEN: true, PICKUP: false, DELIVERY: true }} />));
    const buttons = [...element.querySelectorAll('button')];
    expect(buttons.map(button => button.textContent)).toEqual(['Token', 'Delivery']);
    expect(element.textContent).not.toContain('Table');
    expect(element.textContent).not.toContain('Pickup');
    expect(element.textContent).not.toContain('AdminCore');
    await act(async () => { buttons[0].click(); buttons[1].click(); });
    expect(onChange.mock.calls).toEqual([['TOKEN'], ['DELIVERY']]);
    await act(async () => root.render(<FulfillmentModeSelector value="TABLE" onChange={onChange} />));
    expect(element.innerHTML).toBe('');
    await act(async () => root.render(<FulfillmentModeSelector value="TOKEN" onChange={onChange} allowedModes={{ TOKEN: true }} />));
    expect(element.innerHTML).toBe('');
  } finally { await act(async () => root.unmount()); }
});
