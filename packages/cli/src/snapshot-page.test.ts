// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { collectPageRects } from './snapshot-page';

function add(attrs: Record<string, string>, rect: [number, number, number, number] = [1, 2, 3, 4]): Element {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const [x, y, width, height] = rect;
  el.getBoundingClientRect = () => ({ x, y, width, height }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('collectPageRects', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('names an element by its data-testid', () => {
    add({ 'data-testid': 'hero', id: 'ignored' });
    expect(collectPageRects()).toEqual({ hero: { x: 1, y: 2, width: 3, height: 4 } });
  });

  it('names an element without a testid by its id with a hash prefix', () => {
    add({ id: 'footer' });
    expect(Object.keys(collectPageRects())).toEqual(['#footer']);
  });

  it('suffixes a repeated name with ~2 and ~3', () => {
    add({ 'data-testid': 'row' });
    add({ 'data-testid': 'row' });
    add({ id: 'row' });
    add({ 'data-testid': 'row' });
    expect(Object.keys(collectPageRects())).toEqual(['row', 'row~2', '#row', 'row~3']);
  });

  it('rounds each rect to two decimals', () => {
    add({ id: 'a' }, [1.006,2.344, 3.456, 4.999]);
    expect(collectPageRects()['#a']).toEqual({ x: 1.01, y: 2.34, width: 3.46, height: 5 });
  });

  it('ignores elements with neither data-testid nor id', () => {
    add({});
    add({ id: '' });
    add({ 'data-testid': '' });
    expect(collectPageRects()).toEqual({});
  });
});
