// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { collectRuntime } from './runtime';
import type { Fiber } from './react';

function mount(props: unknown): Element {
  document.body.innerHTML = '<div id="el"></div>';
  const el = document.getElementById('el')!;
  const fiber: Fiber = {
    tag: 0,
    type: function Card() {},
    return: null,
    memoizedProps: props,
  } as Fiber;
  (el as unknown as Record<string, Fiber>)['__reactFiber$test'] = fiber;
  return el;
}

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('runtime props budget', () => {
  it('captures shallow component inputs without nested application state', () => {
    const el = mount({
      title: 'Hello',
      count: 3,
      options: {
        dense: true,
        deep: { sites: [{ snippet: '<script src="https://x.test/i.js">' }] },
      },
    });

    const props = collectRuntime(el, window).props;

    expect(props).toEqual({ title: 'Hello', count: 3, options: { dense: true, deep: '[depth]' } });
    expect(JSON.stringify(props)).not.toContain('snippet');
  });

  it('omits oversized props while preserving the runtime slice', () => {
    window.history.replaceState({}, '', '/a/b');
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`key${i}`, i]));
    const getters = {
      flags: () => ({ beta: true }),
      role: () => 'admin',
      store: () => ({ cart: 1 }),
    };

    for (const props of [{ state: wide }, { text: 'x'.repeat(600) }]) {
      const runtime = collectRuntime(mount(props), window, getters);
      expect('props' in runtime).toBe(false);
      expect(runtime.url).toBeDefined();
      expect(runtime.route).toBeDefined();
      expect(runtime.flags).toEqual({ beta: true });
      expect(runtime.role).toBe('admin');
      expect(runtime.store).toEqual({ cart: 1 });
    }
  });

  it('accepts 500 serialized UTF-8 bytes and omits 501', () => {
    // {"a":"..."} wraps the string in 8 bytes.
    const fill = (value: string): Record<string, string> => ({ a: value });
    for (const unit of ['x', 'é', '😀', '"']) {
      let value = '';
      while (bytes(fill(value + unit)) <= 500) value += unit;
      const atLimit = collectRuntime(mount(fill(value)), window).props;
      expect(bytes(atLimit)).toBeLessThanOrEqual(500);
      // Pad with ASCII to hit exactly 500, then one more byte to hit 501.
      const pad = 500 - bytes(fill(value));
      const exact = fill(value + 'x'.repeat(pad));
      expect(bytes(exact)).toBe(500);
      expect(collectRuntime(mount(exact), window).props).toEqual(exact);
      const over = fill(value + 'x'.repeat(pad + 1));
      expect(bytes(over)).toBe(501);
      expect('props' in collectRuntime(mount(over), window)).toBe(false);
    }
  });

  it('repeats bounded capture without mutating component props', () => {
    const input = { a: 1, b: { c: { d: { e: 'deep' } } } };
    const snapshot = JSON.stringify(input);
    const el = mount(input);

    const first = collectRuntime(el, window).props;
    const second = collectRuntime(el, window).props;

    expect(first).toEqual({ a: 1, b: { c: '[depth]' } });
    expect(second).toEqual(first);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('preserves safe markers and redaction within the props budget', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    const throwingObject = {
      get boom(): string {
        throw new Error('no');
      },
      ok: 1,
    };
    const throwingArray: unknown[] = [1];
    Object.defineProperty(throwingArray, 1, {
      get() {
        throw new Error('no');
      },
      enumerable: true,
    });
    throwingArray.length = 2;

    const props = collectRuntime(
      mount({
        cyclic,
        fn: () => 1,
        node: document.createElement('span'),
        element: { $$typeof: Symbol.for('react.element') },
        apiKey: 'sekret',
        input: { value: 'typed', label: 'L' },
        obj: throwingObject,
        arr: throwingArray,
        state: { nested: { hidden: 1 } },
      }),
      window,
    ).props as Record<string, unknown>;

    expect(props.cyclic).toEqual({ name: 'loop', self: '[circular]' });
    expect(props.fn).toBe('[function]');
    expect(props.node).toBe('[node]');
    expect(props.element).toBe('[element]');
    expect(props.apiKey).toBe('[redacted]');
    expect(props.input).toEqual({ value: '[redacted]', label: 'L' });
    expect(props.obj).toEqual({ boom: '[unavailable]', ok: 1 });
    expect(props.arr).toEqual([1, '[unavailable]']);
    expect(props.state).toEqual({ nested: '[depth]' });
  });

  it('leaves props absent when the marked element has no component fiber', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const runtime = collectRuntime(document.getElementById('el')!, window);
    expect('props' in runtime).toBe(false);
  });
});
