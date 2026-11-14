// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { watchConsole } from './console';
import { watchNavigation } from './actions';
import { collectReactChain, type Fiber } from './react';
import { collectFlags } from './flags';
import type { Entry } from './ring';

function namedFn(name: string): () => void {
  const fn = () => {};
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}

function anonymousFn(): () => void {
  const fn = () => {};
  Object.defineProperty(fn, 'name', { value: '' });
  return fn;
}

function attachFiber(el: Element, fiber: Fiber): void {
  (el as unknown as Record<string, Fiber>)['__reactFiber$test'] = fiber;
}

function stubRect(el: Element, r: { x: number; y: number; width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    top: r.y,
    left: r.x,
    right: r.x + r.width,
    bottom: r.y + r.height,
    toJSON() {
      return this;
    },
  } as DOMRect);
}

function stubOverflow(
  el: Element,
  size: { scrollWidth: number; clientWidth: number; scrollHeight?: number; clientHeight?: number },
) {
  Object.defineProperty(el, 'scrollWidth', { value: size.scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: size.clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: size.scrollHeight ?? 0, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: size.clientHeight ?? 0, configurable: true });
}

describe('round-2 regressions', () => {
  it('preserves later console wrappers after stop', () => {
    const originalError = vi.fn();
    const originalWarn = vi.fn();
    window.console.error = originalError;
    window.console.warn = originalWarn;
    const entries: Entry[] = [];
    const stopConsole = watchConsole(window, (entry) => entries.push(entry));

    const ourError = window.console.error;
    const ourWarn = window.console.warn;
    const outerError = (...args: unknown[]) => ourError(...args);
    const outerWarn = (...args: unknown[]) => ourWarn(...args);
    window.console.error = outerError;
    window.console.warn = outerWarn;

    try {
      stopConsole();

      expect(window.console.error).toBe(outerError);
      expect(window.console.warn).toBe(outerWarn);

      window.console.error('boom');
      window.console.warn('careful');

      expect(entries).toEqual([]);
    } finally {
      window.console.error = originalError;
      window.console.warn = originalWarn;
    }
  });

  it('does not record delegated history calls after stop', () => {
    const nativePushState = window.history.pushState;
    const nativeReplaceState = window.history.replaceState;
    const entries: Entry[] = [];
    const stopNav = watchNavigation(window, (entry) => entries.push(entry));

    const ourPushState = window.history.pushState;
    const ourReplaceState = window.history.replaceState;
    const outerPushState = function (
      this: History,
      ...args: [unknown, string, (string | URL | null)?]
    ) {
      return ourPushState.apply(this, args);
    } as History['pushState'];
    const outerReplaceState = function (
      this: History,
      ...args: [unknown, string, (string | URL | null)?]
    ) {
      return ourReplaceState.apply(this, args);
    } as History['replaceState'];
    window.history.pushState = outerPushState;
    window.history.replaceState = outerReplaceState;

    try {
      stopNav();

      expect(window.history.pushState).toBe(outerPushState);
      expect(window.history.replaceState).toBe(outerReplaceState);

      window.history.pushState({}, '', '/after-stop-push');
      window.history.replaceState({}, '', '/after-stop-replace');

      expect(entries).toEqual([]);
    } finally {
      window.history.pushState = nativePushState;
      window.history.replaceState = nativeReplaceState;
      window.history.replaceState({}, '', '/');
    }
  });

  it('does not assign an anonymous child source to its named parent', () => {
    document.body.innerHTML = '<div id="el" data-source="src/App.tsx:9:2"></div>';
    const el = document.getElementById('el')!;
    const app: Fiber = { tag: 0, type: namedFn('App'), return: null };
    const anon: Fiber = { tag: 0, type: anonymousFn(), return: app };
    attachFiber(el, anon);

    const result = collectReactChain(el);

    expect(result.chain).toEqual([{ name: 'App' }]);
    expect(result.chain[0]?.file).toBeUndefined();
    expect(result.chain[0]?.line).toBeUndefined();
    expect(result.chain[0]?.col).toBeUndefined();

    // A real DOM element's own attached fiber is a host fiber (tag 5), not the
    // component fiber; its data-source must still resolve through the return chain.
    const host = document.createElement('div');
    host.setAttribute('data-source', 'src/Card.tsx:3:1');
    document.body.appendChild(host);
    const card: Fiber = { tag: 0, type: namedFn('Card'), return: null };
    const hostFiber: Fiber = { tag: 5, type: 'div', return: card };
    attachFiber(host, hostFiber);

    const hostResult = collectReactChain(host);

    expect(hostResult.chain).toEqual([{ name: 'Card', file: 'src/Card.tsx', line: 3, col: 1 }]);
  });

  it('does not report a behind sibling when the mark is absent from the hit stack', () => {
    document.body.innerHTML =
      '<div id="el" style="pointer-events: none;">badge</div><div id="siblingBehind">deco</div>';
    const el = document.getElementById('el')!;
    const siblingBehind = document.getElementById('siblingBehind')!;
    const body = document.body;
    const html = document.documentElement;
    stubRect(el, { x: 100, y: 100, width: 40, height: 20 });
    stubOverflow(el, { scrollWidth: 40, clientWidth: 40, scrollHeight: 20, clientHeight: 20 });

    function stubStack(stack: Element[]): void {
      const elementsFromPoint = vi.fn().mockReturnValue(stack);
      (document as unknown as { elementsFromPoint: typeof elementsFromPoint }).elementsFromPoint =
        elementsFromPoint;
    }

    try {
      stubStack([siblingBehind, body, html]);
      expect(collectFlags(el).covered).toBe(false);

      stubStack([siblingBehind]);
      expect(collectFlags(el).covered).toBe(false);

      stubStack([siblingBehind, el, body, html]);
      expect(collectFlags(el).covered).toBe(true);
    } finally {
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });
});
