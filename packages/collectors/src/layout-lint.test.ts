import { describe, expect, it } from 'vitest';
import type { Rect } from '@passback/schema';
import { lintLayout } from './layout-lint';

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

const viewport = { width: 375, height: 800 };

describe('lintLayout', () => {
  it('returns no findings for rects inside the viewport that do not touch', () => {
    const rects = { a: rect(10, 10, 50, 20), b: rect(100, 10, 50, 20) };

    expect(lintLayout(rects, viewport)).toEqual([]);
  });

  it('reports a rect that passes the right edge', () => {
    const rects = { a: rect(350, 10, 50, 20) };

    expect(lintLayout(rects, viewport)).toEqual([{ kind: 'overflow-x', names: ['a'] }]);
  });

  it('reports a rect that passes the left edge', () => {
    const rects = { a: rect(-10, 10, 50, 20) };

    expect(lintLayout(rects, viewport)).toEqual([{ kind: 'overflow-x', names: ['a'] }]);
  });

  it('ignores a rect that is below the viewport', () => {
    const rects = { a: rect(10, 1000, 50, 20) };

    expect(lintLayout(rects, viewport)).toEqual([]);
  });

  it('reports two rects that overlap', () => {
    const rects = { a: rect(0, 0, 20, 20), b: rect(10, 10, 20, 20) };

    expect(lintLayout(rects, viewport)).toEqual([{ kind: 'overlap', names: ['a', 'b'] }]);
  });

  it('does not report a child inside its parent', () => {
    const rects = { parent: rect(0, 0, 100, 100), child: rect(10, 10, 20, 20) };

    expect(lintLayout(rects, viewport)).toEqual([]);
  });

  it('does not report rects that only touch within the tolerance', () => {
    const rects = { a: rect(0, 0, 10, 10), b: rect(9.5, 0, 10, 10) };

    expect(lintLayout(rects, viewport)).toEqual([]);
  });

  it('ignores zero-size rects', () => {
    const rects = { a: rect(350, 0, 0, 20), b: rect(0, 0, 20, 0) };

    expect(lintLayout(rects, viewport)).toEqual([]);
  });

  it('orders findings by kind then name whatever the key order of the input', () => {
    const rects = {
      zeta: rect(350, 10, 50, 20),
      alpha: rect(-10, 200, 50, 20),
      delta: rect(0, 0, 20, 20),
      bravo: rect(10, 10, 20, 20),
    };

    expect(lintLayout(rects, viewport)).toEqual([
      { kind: 'overflow-x', names: ['alpha'] },
      { kind: 'overflow-x', names: ['zeta'] },
      { kind: 'overlap', names: ['bravo', 'delta'] },
    ]);
  });
});
