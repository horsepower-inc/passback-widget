// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { routePattern, safeUrl } from './route';

type WindowWithNextData = Window & { __NEXT_DATA__?: { page?: unknown } };

afterEach(() => {
  window.history.replaceState({}, '', '/');
  delete (window as WindowWithNextData).__NEXT_DATA__;
});

describe('routePattern', () => {
  it('maps /products/42 to /products/:id', () => {
    window.history.pushState({}, '', '/products/42');

    expect(routePattern(window)).toBe('/products/:id');
  });

  it('maps a uuid segment to :id', () => {
    window.history.pushState({}, '', '/orders/9d3b6f1e-2a4c-4b8e-9f0a-1234567890ab');

    expect(routePattern(window)).toBe('/orders/:id');
  });

  it('keeps a non-numeric segment', () => {
    window.history.pushState({}, '', '/products/electronics');

    expect(routePattern(window)).toBe('/products/electronics');
  });

  it('reads the Next page pattern from __NEXT_DATA__', () => {
    window.history.pushState({}, '', '/products/42');
    (window as WindowWithNextData).__NEXT_DATA__ = { page: '/products/[id]' };

    expect(routePattern(window)).toBe('/products/:id');
  });

  it('ignores a __NEXT_DATA__ without a page string', () => {
    window.history.pushState({}, '', '/products/42');
    (window as WindowWithNextData).__NEXT_DATA__ = {};

    expect(routePattern(window)).toBe('/products/:id');
  });

  it('maps an optional catch-all route to a wildcard', () => {
    window.history.pushState({}, '', '/docs');
    (window as WindowWithNextData).__NEXT_DATA__ = { page: '/docs/[[...slug]]' };

    expect(routePattern(window)).toBe('/docs/:slug*');
  });
});

describe('safeUrl', () => {
  it('redacts a token query value in the url', () => {
    window.history.pushState({}, '', '/search?token=abc123&q=shoes#frag');

    expect(safeUrl(window)).toBe(`${window.location.origin}/search?token=%5Bredacted%5D&q=shoes`);
  });
});
