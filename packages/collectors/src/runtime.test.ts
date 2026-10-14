// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Payload, Runtime, redact } from '@passback/schema';
import { collectRuntime, type RuntimeGetters } from './runtime';
import type { Fiber } from './react';

function attachFiber(el: Element, fiber: Fiber): void {
  (el as unknown as Record<string, Fiber>)['__reactFiber$test'] = fiber;
}

function basePayload(runtime: Runtime): Payload {
  return {
    schemaVersion: 1,
    code: { framework: 'react', chain: [] },
    element: { selectors: [], tag: 'div', attrs: {}, text: '', outerHTML: '<div></div>' },
    visual: {
      rects: {
        self: { x: 0, y: 0, width: 0, height: 0 },
        parent: { x: 0, y: 0, width: 0, height: 0 },
      },
      styles: {},
      flags: { clipped: false, covered: false, offViewport: false },
    },
    runtime,
    timeline: [],
    environment: {
      ua: 'test',
      viewport: [0, 0],
      dpr: 1,
      locale: 'en',
      tz: 'UTC',
      colorScheme: 'light',
      reducedMotion: false,
    },
    intent: { comment: '', annotations: [] },
  };
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('collectRuntime', () => {
  it('reads props from the nearest component fiber', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, {
      tag: 0,
      type: function Card() {},
      return: null,
      memoizedProps: { amount: 42 },
    });

    expect(collectRuntime(el, window).props).toEqual({ amount: 42 });
  });

  it('leaves props absent on a node without a fiber', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;

    const runtime = collectRuntime(el, window);

    expect('props' in runtime).toBe(false);
  });

  it('leaves store absent when no getter is configured', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;

    const runtime = collectRuntime(el, window, {});

    expect('store' in runtime).toBe(false);
  });

  it('leaves flags absent when the getter throws', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const getters: RuntimeGetters = {
      flags: () => {
        throw new Error('boom');
      },
    };

    const runtime = collectRuntime(el, window, getters);

    expect('flags' in runtime).toBe(false);
  });

  it('drops non-boolean flag values', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const getters: RuntimeGetters = {
      flags: () => ({ beta: true, legacy: false, plan: 'pro', limit: 42 }),
    };

    expect(collectRuntime(el, window, getters).flags).toEqual({ beta: true, legacy: false });
  });

  it('keeps role only when the getter returns a string', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;

    expect(collectRuntime(el, window, { role: () => 'admin' }).role).toBe('admin');
    expect('role' in collectRuntime(el, window, { role: () => ({ name: 'admin' }) })).toBe(false);
  });

  it('redacts a controlled input value in props', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, {
      tag: 0,
      type: function Input() {},
      return: null,
      memoizedProps: { value: 'private text', defaultValue: 'private default', onChange: () => {} },
    });

    expect(collectRuntime(el, window).props).toEqual({
      value: '[redacted]',
      defaultValue: '[redacted]',
      onChange: '[function]',
    });
  });

  it('redacts a nested controlled input value in props', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, {
      tag: 0,
      type: function Form() {},
      return: null,
      memoizedProps: { inputProps: { value: 'private text', label: 'Name' } },
    });

    expect(collectRuntime(el, window).props).toEqual({
      inputProps: { value: '[redacted]', label: 'Name' },
    });
  });

  it('does not let a JWT in props survive redact()', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const jwt = ['ey' + 'JhbGciOiJIUzI1NiJ9', 'ey' + 'JzdWIiOiIxMjM0In0', 'abc123'].join('.');
    attachFiber(el, { tag: 0, type: function Card() {}, return: null, memoizedProps: { jwt } });

    const runtime = collectRuntime(el, window);
    const payload = redact(basePayload(runtime));

    expect(JSON.stringify(payload)).not.toContain('ey' + 'J');
  });

  it('validates against the schema Runtime', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, {
      tag: 0,
      type: function Card() {},
      return: null,
      memoizedProps: { amount: 1 },
    });
    window.history.pushState({}, '', '/products/42');

    const runtime = collectRuntime(el, window, {
      flags: () => ({ beta: true }),
      role: () => 'admin',
      store: () => ({ cart: 1 }),
    });

    expect(() => Runtime.parse(runtime)).not.toThrow();
  });
});
