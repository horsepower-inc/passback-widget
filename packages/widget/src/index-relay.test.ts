// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Widget } from './index';

let widgets: Widget[] = [];

async function startWithHot(
  local: boolean,
  caps: string[] = ['reopen'],
): Promise<{ on: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }> {
  vi.stubGlobal('__PB_LOCAL__', local);
  const hot = { send: vi.fn(), on: vi.fn(), off: vi.fn() };
  (window as unknown as { __passback: unknown }).__passback = {
    autoStart: false,
    hot,
    caps,
  };
  const { start } = await import('./index');
  widgets.push(start());
  return hot;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  delete (window as unknown as { __passback?: unknown }).__passback;
  vi.unstubAllGlobals();
});

describe('widget HMR bridge by build', () => {
  it('ignores the HMR bridge when __PB_LOCAL__ is false', async () => {
    const hot = await startWithHot(false);

    expect(hot.on).not.toHaveBeenCalled();
  });

  it('listens on the HMR bridge when __PB_LOCAL__ is true', async () => {
    const hot = await startWithHot(true);

    expect(hot.on).toHaveBeenCalledWith('vite:beforeUpdate', expect.any(Function));
  });

  it('does not start the inbox store when __PB_LOCAL__ is false', async () => {
    const hot = await startWithHot(false, ['list']);

    expect(hot.on).not.toHaveBeenCalledWith('passback:items', expect.any(Function));
    expect(hot.send).not.toHaveBeenCalledWith('passback:list', expect.anything());
    expect(
      (window as unknown as { __passback: { inbox?: unknown } }).__passback.inbox,
    ).toBeUndefined();
  });

  it('starts the inbox store and asks for the list once when __PB_LOCAL__ is true and the list capability is present', async () => {
    const hot = await startWithHot(true, ['list']);

    expect(hot.on).toHaveBeenCalledWith('passback:items', expect.any(Function));
    expect(hot.send.mock.calls.filter(([event]) => event === 'passback:list')).toHaveLength(1);
    expect(
      (window as unknown as { __passback: { inbox?: unknown } }).__passback.inbox,
    ).toBeDefined();
    widgets.forEach((widget) => widget.stop());
    expect(
      (window as unknown as { __passback: { inbox?: unknown } }).__passback.inbox,
    ).toBeUndefined();
  });
});
