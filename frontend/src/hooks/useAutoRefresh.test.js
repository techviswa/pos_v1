import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAutoRefresh } from './useAutoRefresh';
jest.mock('../lib/liveUpdates', () => ({ subscribeLiveUpdates: () => () => {} }));

test('a response-triggered render does not start another request', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = jest.fn();
  function Screen() {
    const [count, setCount] = useState(0);
    useAutoRefresh(async () => { calls(); if (count < 3) setCount(count + 1); });
    return <span>{count}</span>;
  }
  const element = document.createElement('div');
  const root = createRoot(element);
  try {
    await act(async () => { root.render(<Screen />); });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(element.textContent).toBe('1');
  } finally { await act(async () => root.unmount()); }
});

test('selecting an outlet after an initially disabled load fetches without remounting', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = jest.fn();
  function Screen({ outlet }) {
    useAutoRefresh(() => calls(outlet), { enabled: Boolean(outlet), refreshKey: outlet });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Screen outlet="" />));
    expect(calls).not.toHaveBeenCalled();
    await act(async () => root.render(<Screen outlet="main" />));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls).toHaveBeenCalledWith('main');
  } finally { await act(async () => root.unmount()); }
});

test('a new outlet starts immediately while the previous outlet request is pending', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let finishOld;
  const calls = jest.fn(outlet => outlet === 'old' ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve());
  function Screen({ outlet }) {
    useAutoRefresh(() => calls(outlet), { refreshKey: outlet });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Screen outlet="old" />));
    await act(async () => root.render(<Screen outlet="new" />));
    expect(calls.mock.calls.map(([outlet]) => outlet)).toEqual(['old', 'new']);
    await act(async () => finishOld());
    expect(calls).toHaveBeenCalledTimes(2);
  } finally { await act(async () => root.unmount()); }
});
