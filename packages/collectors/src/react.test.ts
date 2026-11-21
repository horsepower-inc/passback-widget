// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Code } from '@passback/schema';
import { MAX_CHAIN, collectReactChain, nearestComponentFiber, type Fiber } from './react';

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

function fc(name: string, returnFiber: Fiber | null): Fiber {
  return { tag: 0, type: namedFn(name), return: returnFiber };
}

function attachFiber(el: Element, fiber: Fiber): void {
  (el as unknown as Record<string, Fiber>)['__reactFiber$test'] = fiber;
}

describe('collectReactChain', () => {
  it('returns unknown with an empty chain when the node has no fiber', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;

    expect(collectReactChain(el)).toEqual({ framework: 'unknown', chain: [] });
  });

  it('builds the chain outermost first', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const page = fc('ProductPage', app);
    const card = fc('ProductCard', page);
    const price = fc('PriceTag', card);
    attachFiber(el, price);

    const result = collectReactChain(el);

    expect(result.framework).toBe('react');
    expect(result.chain.map((c) => c.name)).toEqual([
      'App',
      'ProductPage',
      'ProductCard',
      'PriceTag',
    ]);
  });

  it('skips host components and context providers', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const provider: Fiber = { tag: 10, type: {}, return: app };
    const host: Fiber = { tag: 5, type: 'div', return: provider };
    const card = fc('Card', host);
    attachFiber(el, card);

    const result = collectReactChain(el);

    expect(result.chain.map((c) => c.name)).toEqual(['App', 'Card']);
  });

  it('names forwardRef and memo components', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const forwarded: Fiber = { tag: 11, type: { render: namedFn('Inner') }, return: app };
    const memoed: Fiber = { tag: 14, type: { type: namedFn('Memoized') }, return: forwarded };
    attachFiber(el, memoed);

    const result = collectReactChain(el);

    expect(result.chain.map((c) => c.name)).toEqual(['App', 'Inner', 'Memoized']);
  });

  it('skips anonymous components', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const anon: Fiber = { tag: 0, type: anonymousFn(), return: app };
    const card = fc('Card', anon);
    attachFiber(el, card);

    const result = collectReactChain(el);

    expect(result.chain.map((c) => c.name)).toEqual(['App', 'Card']);
  });

  it('keeps the eight components nearest the node', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    let current: Fiber | null = null;
    for (let i = 0; i < 10; i++) {
      current = fc(`C${i}`, current);
    }
    attachFiber(el, current!);

    const result = collectReactChain(el);

    expect(result.chain.map((c) => c.name)).toEqual([
      'C2',
      'C3',
      'C4',
      'C5',
      'C6',
      'C7',
      'C8',
      'C9',
    ]);
    expect(result.chain.length).toBe(MAX_CHAIN);
  });

  it('finds the fiber on the nearest ancestor with one', () => {
    document.body.innerHTML = '<div id="parent"><span id="child"></span></div>';
    const parent = document.getElementById('parent')!;
    const child = document.getElementById('child')!;
    attachFiber(parent, fc('App', null));

    const result = collectReactChain(child);

    expect(result.chain.map((c) => c.name)).toEqual(['App']);
  });

  it('applies data-source file, line and col to the innermost component', () => {
    document.body.innerHTML = '<div id="el" data-source="src/App.tsx:21:5"></div>';
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const card = fc('Card', app);
    attachFiber(el, card);

    const result = collectReactChain(el);

    expect(result.chain[0]).toEqual({ name: 'App' });
    expect(result.chain[1]).toEqual({ name: 'Card', file: 'src/App.tsx', line: 21, col: 5 });
  });

  it('ignores a malformed data-source', () => {
    document.body.innerHTML = '<div id="el" data-source="not-a-location"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, fc('App', null));

    const result = collectReactChain(el);

    expect(result.chain).toEqual([{ name: 'App' }]);
  });

  it('returns unknown instead of throwing on a hostile fiber', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const hostile: Fiber = {
      tag: 0,
      type: namedFn('Foo'),
      get return(): Fiber | null {
        throw new Error('boom');
      },
    };
    attachFiber(el, hostile);

    expect(() => collectReactChain(el)).not.toThrow();
    expect(collectReactChain(el)).toEqual({ framework: 'unknown', chain: [] });
  });

  it('returns the nearest component fiber for props', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const props = { amount: 1299 };
    const card: Fiber = { tag: 0, type: namedFn('Card'), return: null, memoizedProps: props };
    const host: Fiber = { tag: 5, type: 'div', return: card };
    attachFiber(el, host);

    const fiber = nearestComponentFiber(el);

    expect(fiber?.memoizedProps).toBe(props);
  });

  it('takes props from an anonymous component instead of an ancestor', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const anonProps = { size: 'lg' };
    const anon: Fiber = { tag: 0, type: anonymousFn(), return: app, memoizedProps: anonProps };
    attachFiber(el, anon);

    const fiber = nearestComponentFiber(el);

    expect(fiber?.memoizedProps).toBe(anonProps);
  });

  it('records a hash-only data-source as the hash of the innermost component', () => {
    document.body.innerHTML = '<div id="el" data-source="deadbeef"></div>';
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const card = fc('Card', app);
    attachFiber(el, card);

    const result = collectReactChain(el);

    expect(result.chain[0]).toEqual({ name: 'App' });
    expect(result.chain[1]).toEqual({ name: 'Card', hash: 'deadbeef' });
  });

  it('ignores a hash-only data-source owned by a different component', () => {
    document.body.innerHTML = '<div id="outer" data-source="deadbeef"><div id="el"></div></div>';
    const outer = document.getElementById('outer')!;
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const outerFiber = fc('Outer', app);
    attachFiber(outer, outerFiber);
    const inner = fc('Inner', outerFiber);
    attachFiber(el, inner);

    const result = collectReactChain(el);

    expect(result.chain).toEqual([{ name: 'App' }, { name: 'Outer' }, { name: 'Inner' }]);
  });

  it('validates a hash-only chain entry against the schema Code', () => {
    document.body.innerHTML = '<div id="el" data-source="deadbeef"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, fc('App', null));

    expect(() => Code.parse({ ...collectReactChain(el), buildId: 'test' })).not.toThrow();
  });

  it('ignores a data-source owned by a different component', () => {
    document.body.innerHTML =
      '<div id="outer" data-source="src/Outer.tsx:5:1"><div id="el"></div></div>';
    const outer = document.getElementById('outer')!;
    const el = document.getElementById('el')!;
    const app = fc('App', null);
    const outerFiber = fc('Outer', app);
    attachFiber(outer, outerFiber);
    const inner = fc('Inner', outerFiber);
    attachFiber(el, inner);

    const result = collectReactChain(el);

    expect(result.chain).toEqual([{ name: 'App' }, { name: 'Outer' }, { name: 'Inner' }]);
  });

  it('validates against the schema Code with a buildId added', () => {
    document.body.innerHTML = '<div id="el" data-source="src/App.tsx:21:5"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, fc('App', null));

    expect(() => Code.parse({ ...collectReactChain(el), buildId: 'test' })).not.toThrow();
  });
});
