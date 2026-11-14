// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { routePattern, safeHref, safeUrl } from './route';

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

describe('safeHref', () => {
  it('masks secret query values in a relative address without making it absolute and drops the fragment', () => {
    expect(safeHref('/reset?token=abc123&a=1&password=p#frag')).toBe(
      '/reset?token=%5Bredacted%5D&a=1&password=%5Bredacted%5D',
    );
    expect(safeHref('//example.com/x?api_key=abc123')).toBe(
      '//example.com/x?api_key=%5Bredacted%5D',
    );
    expect(safeHref('/x#token=abc123')).toBe('/x');
    expect(safeHref(safeHref('/x?token=abc123'))).toBe('/x?token=%5Bredacted%5D');
  });

  it('returns odd values without throwing and harmless ones unchanged', () => {
    expect(safeHref('')).toBe('');
    expect(safeHref('?')).toBe('?');
    expect(safeHref('#')).toBe('');
    expect(safeHref('javascript:void(0)')).toBe('javascript:void(0)');
    expect(safeHref('mailto:a@example.com?subject=a%20b')).toBe(
      'mailto:a@example.com?subject=a%20b',
    );
    expect(safeHref('/p?a=b%20c&d')).toBe('/p?a=b%20c&d');
    expect(safeHref('/p?x=%E0%A4%A')).toBe('/p?x=%E0%A4%A');
  });
});
