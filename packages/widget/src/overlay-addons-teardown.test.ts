// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
});

function open() {
  const host = document.body.appendChild(document.createElement('div'));
  const overlay = createOverlay({
    doc: document,
    root: host.attachShadow({ mode: 'open' }),
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
  });
  overlays.push(overlay);
  return overlay;
}

describe('overlay add-on teardown', () => {
  it('destroy before passback:fx leaves no add-on listener behind', () => {
    const addon = vi.fn();
    open().destroy();
    scope.__passback = { fx: { addons: [addon] } };
    document.dispatchEvent(new Event('passback:fx'));
    expect(addon).not.toHaveBeenCalled();
  });

  it('an overlay that stays open still attaches add-ons on passback:fx', () => {
    const addon = vi.fn();
    open();
    scope.__passback = { fx: { addons: [addon] } };
    document.dispatchEvent(new Event('passback:fx'));
    expect(addon).toHaveBeenCalledTimes(1);
  });
});
