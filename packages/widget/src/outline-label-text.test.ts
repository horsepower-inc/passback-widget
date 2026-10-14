// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { labelOf } from './outline-label-text';

type TestFiber = { tag: number; type: unknown; key: string | null; return: TestFiber | null };

function component(name: string, key: string | null, parent: TestFiber | null): TestFiber {
  return { tag: 0, type: { name }, key, return: parent };
}

function withFiber(el: Element, fiber: TestFiber): void {
  (el as unknown as Record<string, TestFiber>)['__reactFiber$t'] = fiber;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('labelOf', () => {
  it('names the last two components with their React key and the file and line', () => {
    document.body.innerHTML =
      '<div data-source="src/components/BuyButton.tsx:17:5"><button id="b">Buy</button></div>';
    const app = component('App', null, null);
    const card = component('ProductCard', '1', app);
    const buy = component('BuyButton', null, card);
    const button = document.getElementById('b')!;
    withFiber(button, buy);
    expect(labelOf(button)).toBe('ProductCard[key=1] › BuyButton · BuyButton.tsx:17');
  });

  it('leaves the key off an unkeyed component', () => {
    document.body.innerHTML = '<button id="b">Buy</button>';
    const button = document.getElementById('b')!;
    withFiber(button, component('BuyButton', null, null));
    expect(labelOf(button)).toBe('BuyButton');
    button.setAttribute('data-source', 'a/b/BuyButton.tsx:17:5');
    expect(labelOf(button)).toBe('BuyButton · BuyButton.tsx:17');
  });

  it('falls back to data-testid, then tag#id, then tag.class', () => {
    document.body.innerHTML =
      '<i data-testid="buy-cta" id="x"></i><b id="x2" class="a"></b><u class="c d"></u><s></s>';
    const [a, b, c, d] = Array.from(document.body.children);
    expect(labelOf(a!)).toBe('buy-cta');
    expect(labelOf(b!)).toBe('b#x2');
    expect(labelOf(c!)).toBe('u.c');
    expect(labelOf(d!)).toBe('s');
  });
});
