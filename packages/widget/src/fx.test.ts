// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachAddons, celebrate } from './fx';

const scope = globalThis as { __passback?: unknown };
const at = { x: 10, y: 20 };
let root: ShadowRoot;
let dot: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
  dot = root.appendChild(document.createElement('div'));
  delete scope.__passback;
});

afterEach(() => {
  vi.useRealTimers();
  delete scope.__passback;
  document.body.innerHTML = '';
});

describe('fx', () => {
  it('headroom shows the static stamp when the effects chunk has not registered', () => {
    const made = celebrate(root, dot, 'sent', at);
    const stamp = root.querySelector('.pb-stamp');
    expect(stamp?.textContent).toBe('SENT!');
    made.move({ x: 30, y: 40 });
    expect((stamp as HTMLElement).style.left).toBe('52px');
    vi.advanceTimersByTime(1800);
    expect(root.querySelector('.pb-stamp')).toBeNull();
  });

  it('headroom falls back to the static stamp when the registered celebration throws', () => {
    scope.__passback = {
      fx: {
        celebrate: () => {
          throw new Error('boom');
        },
      },
    };
    expect(() => celebrate(root, dot, 'done', at)).not.toThrow();
    expect(root.querySelector('.pb-stamp')?.textContent).toBe('FIXED ✓');
  });

  it('addons run once with the overlay context when the chunk has registered', () => {
    const addon = vi.fn();
    scope.__passback = { fx: { addons: [addon] } };
    const ctx = { root, host: root.host as HTMLElement, doc: document };
    attachAddons(ctx);
    document.dispatchEvent(new Event('passback:fx'));
    expect(addon).toHaveBeenCalledTimes(1);
    expect(addon).toHaveBeenCalledWith(ctx);
  });

  it('addons wait for passback:fx when the chunk has not registered and skip a disconnected host', () => {
    const addon = vi.fn();
    const ctx = { root, host: root.host as HTMLElement, doc: document };
    attachAddons(ctx);
    expect(addon).not.toHaveBeenCalled();
    scope.__passback = { fx: { addons: [addon] } };
    document.dispatchEvent(new Event('passback:fx'));
    document.dispatchEvent(new Event('passback:fx'));
    expect(addon).toHaveBeenCalledTimes(1);

    const gone = document.createElement('div');
    const late = { root: gone.attachShadow({ mode: 'open' }), host: gone, doc: document };
    attachAddons(late);
    expect(addon).toHaveBeenCalledTimes(1);
  });

  it('headroom uses the registered celebration and passes it move and remove', () => {
    const made = { move: vi.fn(), remove: vi.fn() };
    const registered = vi.fn(() => made);
    scope.__passback = { fx: { celebrate: registered } };
    const got = celebrate(root, dot, 'done', at);
    expect(registered).toHaveBeenCalledWith(root, dot, 'done', at);
    got.move(at);
    got.remove();
    expect(made.move).toHaveBeenCalledWith(at);
    expect(made.remove).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.pb-stamp')).toBeNull();
  });
});
