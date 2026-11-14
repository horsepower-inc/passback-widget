// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Visual } from '@passback/schema';
import { collectRects, toRect } from './rects';

function stubRect(el: Element, r: { x: number; y: number; width: number; height: number }) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    top: r.y,
    left: r.x,
    right: r.x + r.width,
    bottom: r.y + r.height,
    toJSON() {
      return this;
    },
  } as DOMRect);
}

describe('collectRects', () => {
  it('measures self, parent, prev and next', () => {
    document.body.innerHTML =
      '<div id="parent"><span id="prev"></span><span id="self"></span><span id="next"></span></div>';
    const parent = document.getElementById('parent')!;
    const self = document.getElementById('self')!;
    const prev = document.getElementById('prev')!;
    const next = document.getElementById('next')!;
    stubRect(parent, { x: 0, y: 0, width: 300, height: 100 });
    stubRect(self, { x: 100, y: 10, width: 50, height: 20 });
    stubRect(prev, { x: 10, y: 10, width: 50, height: 20 });
    stubRect(next, { x: 200, y: 10, width: 50, height: 20 });

    const rects = collectRects(self);

    expect(rects.self).toEqual({ x: 100, y: 10, width: 50, height: 20 });
    expect(rects.parent).toEqual({ x: 0, y: 0, width: 300, height: 100 });
    expect(rects.prev).toEqual({ x: 10, y: 10, width: 50, height: 20 });
    expect(rects.next).toEqual({ x: 200, y: 10, width: 50, height: 20 });
  });

  it('omits prev and next for an only child', () => {
    document.body.innerHTML = '<div id="parent"><span id="self"></span></div>';
    const parent = document.getElementById('parent')!;
    const self = document.getElementById('self')!;
    stubRect(parent, { x: 0, y: 0, width: 100, height: 50 });
    stubRect(self, { x: 10, y: 10, width: 20, height: 20 });

    const rects = collectRects(self);

    expect(rects.prev).toBeUndefined();
    expect(rects.next).toBeUndefined();
  });

  it('finds the nearest positioned ancestor', () => {
    document.body.innerHTML =
      '<div id="outer" style="position:relative"><div id="middle"><span id="self"></span></div></div>';
    const outer = document.getElementById('outer')!;
    const middle = document.getElementById('middle')!;
    const self = document.getElementById('self')!;
    stubRect(outer, { x: 0, y: 0, width: 500, height: 500 });
    stubRect(middle, { x: 5, y: 5, width: 400, height: 400 });
    stubRect(self, { x: 10, y: 10, width: 10, height: 10 });

    const rects = collectRects(self);

    expect(rects.positioned).toEqual({ x: 0, y: 0, width: 500, height: 500 });
  });

  it('omits positioned when every ancestor is static', () => {
    document.body.innerHTML = '<div id="a"><div id="b"><span id="self"></span></div></div>';
    const b = document.getElementById('b')!;
    const self = document.getElementById('self')!;
    stubRect(b, { x: 0, y: 0, width: 100, height: 100 });
    stubRect(self, { x: 10, y: 10, width: 10, height: 10 });

    const rects = collectRects(self);

    expect(rects.positioned).toBeUndefined();
  });

  it('rounds to two decimals', () => {
    expect(toRect({ x: 12.3456, y: 0.001, width: 100, height: 7.994 })).toEqual({
      x: 12.35,
      y: 0,
      width: 100,
      height: 7.99,
    });
  });

  it('validates against the schema Visual rects', () => {
    document.body.innerHTML = '<div id="parent"><span id="self"></span></div>';
    const parent = document.getElementById('parent')!;
    const self = document.getElementById('self')!;
    stubRect(parent, { x: 0, y: 0, width: 100, height: 50 });
    stubRect(self, { x: 10, y: 10, width: 20, height: 20 });

    const rects = collectRects(self);

    expect(() => Visual.shape.rects.parse(rects)).not.toThrow();
  });
});
