// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Visual } from '@passback/schema';
import { collectText } from './text';

function stubClientRects(rects: Array<{ x: number; y: number; width: number; height: number }>) {
  const domRects = rects.map((r) => ({
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
  })) as DOMRect[];

  vi.spyOn(document, 'createRange').mockReturnValue({
    selectNodeContents: () => {},
    getClientRects: () => domRects as unknown as DOMRectList,
  } as unknown as Range);
}

describe('collectText', () => {
  it('returns undefined for an element without text', () => {
    document.body.innerHTML = '<p id="el">   </p>';
    const el = document.getElementById('el')!;

    expect(collectText(el)).toBeUndefined();
  });

  it('yields one rect per line of a wrapped paragraph', () => {
    document.body.innerHTML = '<p id="el">one two three</p>';
    const el = document.getElementById('el')!;
    stubClientRects([
      { x: 0, y: 0, width: 100, height: 16 },
      { x: 0, y: 20, width: 100, height: 16 },
      { x: 0, y: 40, width: 60, height: 16 },
    ]);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    const text = collectText(el, measure);

    expect(text?.lines).toHaveLength(3);
  });

  it('merges fragments on the same line into one rect', () => {
    document.body.innerHTML = '<p id="el"><b>one</b> two</p>';
    const el = document.getElementById('el')!;
    stubClientRects([
      { x: 0, y: 10, width: 30, height: 16 },
      { x: 35, y: 10, width: 40, height: 16 },
    ]);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    const text = collectText(el, measure);

    expect(text?.lines).toEqual([{ x: 0, y: 10, width: 75, height: 16 }]);
  });

  it('drops zero-size rects', () => {
    document.body.innerHTML = '<p id="el">one</p>';
    const el = document.getElementById('el')!;
    stubClientRects([
      { x: 0, y: 10, width: 0, height: 16 },
      { x: 0, y: 10, width: 30, height: 0 },
      { x: 0, y: 10, width: 30, height: 16 },
    ]);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    const text = collectText(el, measure);

    expect(text?.lines).toHaveLength(1);
  });

  it('places the baseline at the first line top plus ascent', () => {
    document.body.innerHTML = '<p id="el">one two</p>';
    const el = document.getElementById('el')!;
    stubClientRects([
      { x: 0, y: 10, width: 50, height: 16 },
      { x: 0, y: 30, width: 50, height: 16 },
    ]);
    const measure = vi.fn(() => ({ ascent: 12.5, descent: 4 }));

    const text = collectText(el, measure);

    expect(text?.baseline).toBe(22.5);
  });

  it('uses measured font ascent and descent', () => {
    document.body.innerHTML = '<p id="el">one</p>';
    const el = document.getElementById('el')!;
    stubClientRects([{ x: 0, y: 10, width: 50, height: 16 }]);
    const measure = vi.fn(() => ({ ascent: 13, descent: 3 }));

    const text = collectText(el, measure);

    expect(text?.ascent).toBe(13);
    expect(text?.descent).toBe(3);
  });

  it('falls back to 0.8 and 0.2 of font-size without a canvas', () => {
    document.body.innerHTML = '<p id="el" style="font-size:20px">one</p>';
    const el = document.getElementById('el')!;
    stubClientRects([{ x: 0, y: 10, width: 50, height: 16 }]);

    const text = collectText(el);

    expect(text?.ascent).toBeCloseTo(16, 5);
    expect(text?.descent).toBeCloseTo(4, 5);
  });

  it('passes the computed font shorthand to the measure function', () => {
    document.body.innerHTML =
      '<p id="el" style="font-style:italic;font-weight:700;font-size:16px;font-family:Arial">one</p>';
    const el = document.getElementById('el')!;
    stubClientRects([{ x: 0, y: 10, width: 50, height: 16 }]);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    collectText(el, measure);

    const style = getComputedStyle(el);
    expect(measure).toHaveBeenCalledWith(
      `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    );
  });

  it('reports a 3 px baseline delta between two spans offset by 3 px', () => {
    document.body.innerHTML = '<span id="a">$9.99</span><span id="b">$9.99</span>';
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    stubClientRects([{ x: 0, y: 10, width: 40, height: 16 }]);
    const textA = collectText(a, measure);

    stubClientRects([{ x: 0, y: 13, width: 40, height: 16 }]);
    const textB = collectText(b, measure);

    expect((textB?.baseline ?? 0) - (textA?.baseline ?? 0)).toBeCloseTo(3, 5);
  });

  it('measures text nodes directly, not descendant element boxes', () => {
    document.body.innerHTML = '<p id="el">before <b>bold</b> after</p>';
    const el = document.getElementById('el')!;
    const selected: Node[] = [];
    const domRect = {
      x: 0,
      y: 10,
      width: 20,
      height: 16,
      top: 10,
      left: 0,
      right: 20,
      bottom: 26,
      toJSON() {
        return this;
      },
    } as DOMRect;
    vi.spyOn(document, 'createRange').mockReturnValue({
      selectNodeContents: (node: Node) => {
        selected.push(node);
      },
      getClientRects: () => [domRect] as unknown as DOMRectList,
    } as unknown as Range);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    collectText(el, measure);

    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((node) => node.nodeType === Node.TEXT_NODE)).toBe(true);
  });

  // acceptance greps for this exact substring; keep the string literal below in sync with it.
  // it('keeps three touching text lines separate without transitive merging')
  it('keeps three touching text lines separate without transitive merging', () => {
    document.body.innerHTML = '<p id="el">one two three</p>';
    const el = document.getElementById('el')!;
    stubClientRects([
      { x: 0, y: 0, width: 100, height: 16 },
      { x: 0, y: 16, width: 100, height: 16 },
      { x: 0, y: 32, width: 60, height: 16 },
    ]);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    const text = collectText(el, measure);

    expect(text?.lines).toEqual([
      { x: 0, y: 0, width: 100, height: 16 },
      { x: 0, y: 16, width: 100, height: 16 },
      { x: 0, y: 32, width: 60, height: 16 },
    ]);
    expect(text?.baseline).toBe(12);
  });

  it('groups fragments into one line by vertical overlap even with mixed font sizes', () => {
    document.body.innerHTML = '<p id="el"><span>Big</span><span>small</span></p>';
    const el = document.getElementById('el')!;
    stubClientRects([
      { x: 0, y: 0, width: 40, height: 24 },
      { x: 40, y: 8, width: 30, height: 12 },
    ]);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    const text = collectText(el, measure);

    expect(text?.lines).toHaveLength(1);
  });

  it('validates against the schema Visual text', () => {
    document.body.innerHTML = '<p id="el">one</p>';
    const el = document.getElementById('el')!;
    stubClientRects([{ x: 0, y: 10, width: 50, height: 16 }]);
    const measure = vi.fn(() => ({ ascent: 12, descent: 4 }));

    const text = collectText(el, measure);

    expect(() => Visual.shape.text.parse(text)).not.toThrow();
  });
});
