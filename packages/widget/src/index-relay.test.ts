// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Widget } from './index';

let widgets: Widget[] = [];

async function startWithHot(local: boolean): Promise<{ on: ReturnType<typeof vi.fn> }> {
  vi.stubGlobal('__PB_LOCAL__', local);
  const hot = { send: vi.fn(), on: vi.fn(), off: vi.fn() };
  (window as unknown as { __passback: unknown }).__passback = {
    autoStart: false,
    hot,
    caps: ['reopen'],
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
});
