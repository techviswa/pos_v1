import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Ranking } from './SalesVisuals';

test('rankings expose all rows beyond the initial six and label a single unit correctly', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement('div'), root = createRoot(element);
  try {
    const rows = Array.from({ length: 9 }, (_, index) => ({ name: `Product ${index + 1}`, value: index + 1 }));
    await act(async () => root.render(<Ranking title="Products" rows={rows} />));
    expect(element.querySelectorAll('li')).toHaveLength(6);
    expect(element.textContent).toContain('Showing 6 of 9');
    await act(async () => element.querySelector('button').click());
    expect(element.querySelectorAll('li')).toHaveLength(9);
    expect(element.textContent).toContain('1 unit');
    expect(element.textContent).not.toContain('1 units');
    expect(element.textContent).toContain('Showing 9 of 9');
  } finally { await act(async () => root.unmount()); }
});
