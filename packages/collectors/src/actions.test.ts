// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_THROTTLE_MS, watchActions, watchNavigation } from './actions';
import type { Entry } from './ring';

function setScroll(x: number, y: number): void {
  Object.defineProperty(window, 'scrollX', { value: x, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  window.history.replaceState({}, '', '/');
});

describe('watchNavigation', () => {
  it('records pushState as navigation from the old path to the new', () => {
    const entries: Entry[] = [];
    stop = watchNavigation(window, (entry) => entries.push(entry));

    window.history.pushState({}, '', '/products/42');

    expect(entries).toEqual([{ kind: 'navigation', from: '/', to: '/products/42' }]);
  });

  it('records popstate', () => {
    const entries: Entry[] = [];
    const rawPushState = window.history.pushState.bind(window.history);
    stop = watchNavigation(window, (entry) => entries.push(entry));

    rawPushState({}, '', '/two');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(entries).toEqual([{ kind: 'navigation', from: '/', to: '/two' }]);
  });

  it('drops the query string from navigation paths', () => {
    const entries: Entry[] = [];
    stop = watchNavigation(window, (entry) => entries.push(entry));

    window.history.pushState({}, '', '/search?q=hello#frag');

    expect(entries).toEqual([{ kind: 'navigation', from: '/', to: '/search' }]);
  });

  it('does not restore a wrapper installed by another script after stop', () => {
    const originalPushState = window.history.pushState;
    stop = watchNavigation(window, () => {});

    const laterWrapper = (() => {}) as typeof window.history.pushState;
    window.history.pushState = laterWrapper;

    stop();
    stop = undefined;

    expect(window.history.pushState).toBe(laterWrapper);

    window.history.pushState = originalPushState;
  });
});

describe('watchActions', () => {
  it('records a click with the target selector', () => {
    document.body.innerHTML = '<button data-testid="go">Go</button>';
    const button = document.querySelector('button')!;
    const entries: Entry[] = [];
    stop = watchActions(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    button.click();

    expect(entries).toEqual([{ kind: 'action', type: 'click', selector: '[data-testid="go"]' }]);
  });

  it('records input with a selector and no value', () => {
    document.body.innerHTML = '<input id="email" />';
    const input = document.querySelector('input')!;
    const entries: Entry[] = [];
    stop = watchActions(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    input.value = 'secret@example.com';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(entries).toEqual([{ kind: 'action', type: 'input', selector: '#email' }]);
    expect(JSON.stringify(entries)).not.toContain('secret@example.com');
  });

  it('never leaks contenteditable text into the recorded selector', () => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox"></div>';
    const editable = document.querySelector('div')!;
    const entries: Entry[] = [];
    stop = watchActions(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    editable.textContent = 'hunter2';
    editable.dispatchEvent(new Event('input', { bubbles: true }));

    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain('hunter2');
  });

  function mountHost(): HTMLButtonElement | null {
    document.body.innerHTML =
      '<button data-testid="page">Page</button><div data-passback-host></div>';
    const root = document.querySelector('[data-passback-host]')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<button>Ball</button><input />';
    return document.querySelector('[data-testid="page"]');
  }

  it('ignores a click and an input inside the widget host', () => {
    mountHost();
    const root = document.querySelector('[data-passback-host]')!.shadowRoot!;
    const entries: Entry[] = [];
    stop = watchActions(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    root.querySelector('button')!.click();
    root
      .querySelector('input')!
      .dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    expect(entries).toEqual([]);
  });

  it('still records a page click next to the widget host', () => {
    const pageButton = mountHost()!;
    const entries: Entry[] = [];
    stop = watchActions(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    pageButton.click();

    expect(entries).toEqual([{ kind: 'action', type: 'click', selector: '[data-testid="page"]' }]);
  });

  it('throttles scroll to one entry per 250 ms', () => {
    const entries: Entry[] = [];
    let t = 0;
    setScroll(0, 0);
    stop = watchActions(
      window,
      (entry) => entries.push(entry),
      () => t,
    );

    setScroll(10, 20);
    t = 0;
    window.dispatchEvent(new Event('scroll'));

    setScroll(15, 20);
    t = SCROLL_THROTTLE_MS - 1;
    window.dispatchEvent(new Event('scroll'));

    setScroll(30, 20);
    t = SCROLL_THROTTLE_MS;
    window.dispatchEvent(new Event('scroll'));

    expect(entries).toEqual([
      { kind: 'action', type: 'scroll', delta: [10, 20] },
      { kind: 'action', type: 'scroll', delta: [20, 0] },
    ]);
  });

  it('flushes the trailing scroll once the throttle window elapses', () => {
    vi.useFakeTimers();
    try {
      const entries: Entry[] = [];
      let t = 0;
      setScroll(0, 0);
      stop = watchActions(
        window,
        (entry) => entries.push(entry),
        () => t,
      );

      setScroll(10, 0);
      t = 0;
      window.dispatchEvent(new Event('scroll'));

      setScroll(25, 0);
      t = 100;
      window.dispatchEvent(new Event('scroll'));

      expect(entries).toHaveLength(1);

      t = SCROLL_THROTTLE_MS;
      vi.advanceTimersByTime(SCROLL_THROTTLE_MS);

      expect(entries).toEqual([
        { kind: 'action', type: 'scroll', delta: [10, 0] },
        { kind: 'action', type: 'scroll', delta: [15, 0] },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
