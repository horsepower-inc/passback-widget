// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectReactChain, reactComponentPath, type Fiber } from './react';
import { selectorChain } from './selectors';

function namedFn(name: string): () => void {
  const fn = () => {};
  Object.defineProperty(fn, 'name', { value: name });
  return fn;
}

function fc(name: string, returnFiber: Fiber | null): Fiber {
  return { tag: 0, type: namedFn(name), return: returnFiber };
}

function attach(el: Element, fiber: Fiber): void {
  (el as unknown as Record<string, Fiber>)['__reactFiber$test'] = fiber;
}

function mount(fiber: Fiber | null): Element {
  document.body.innerHTML = '<div id="el"></div>';
  const el = document.getElementById('el')!;
  if (fiber) attach(el, fiber);
  return el;
}

describe('react component path', () => {
  it('puts the full React component path first in the selector chain', () => {
    const el = mount(fc('Price', fc('Card', fc('App', null))));
    const chain = selectorChain(el);
    expect(chain[0]).toEqual({ kind: 'react', value: 'App > Card > Price' });
    expect(chain.slice(1).map((s) => s.kind)).toEqual(['id', 'css']);
  });

  it('keeps every component name past the eight of the code chain', () => {
    let fiber: Fiber | null = null;
    const names: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      names.push(`C${i}`);
      fiber = fc(`C${i}`, fiber);
    }
    const el = mount(fiber);
    expect(reactComponentPath(el)).toBe(names.join(' > '));
    expect(collectReactChain(el).chain).toHaveLength(8);
  });

  it('skips fibers that are not components and adds nothing without a fiber', () => {
    const host: Fiber = { tag: 5, type: 'div', return: fc('App', null) };
    const el = mount({ tag: 5, type: 'span', return: host });
    expect(reactComponentPath(el)).toBe('App');
    expect(selectorChain(mount(null)).some((s) => s.kind === 'react')).toBe(false);
    const child = document.createElement('i');
    el.appendChild(child);
    expect(reactComponentPath(child)).toBeUndefined();
    expect(reactComponentPath(mount({ tag: 5, type: 'div', return: null }))).toBeUndefined();
  });

  it('leaves the react entry out when the path is not safe whole or the walk never ends', () => {
    expect(reactComponentPath(mount(fc('Bad\u0007Name', fc('App', null))))).toBeUndefined();
    expect(reactComponentPath(mount(fc('Lone\ud800', fc('App', null))))).toBeUndefined();
    expect(reactComponentPath(mount(fc('Authorization: Bearer abc', null)))).toBeUndefined();
    expect(reactComponentPath(mount(fc('eyJhbGci.eyJzdWIi.sig', null)))).toBeUndefined();

    const loop = fc('Loop', null) as { return: Fiber | null };
    loop.return = loop as Fiber;
    expect(reactComponentPath(mount(loop as Fiber))).toBeUndefined();
    expect(selectorChain(mount(loop as Fiber)).some((s) => s.kind === 'react')).toBe(false);

    const proxyFiber = (): Fiber => ({
      tag: 0,
      type: namedFn('P'),
      get return(): Fiber {
        return proxyFiber();
      },
    });
    expect(reactComponentPath(mount(proxyFiber()))).toBeUndefined();

    const throwing = {
      tag: 0,
      type: namedFn('T'),
      get return(): Fiber {
        throw new Error('boom');
      },
    } as Fiber;
    expect(reactComponentPath(mount(throwing))).toBeUndefined();
  });
});
