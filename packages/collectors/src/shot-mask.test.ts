// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { shotMaskRects } from './shot-mask';

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

const crop = { x: 0, y: 0, width: 500, height: 500 };

describe('shotMaskRects', () => {
  it('returns a box for each input, textarea, select and iframe inside the crop', () => {
    document.body.innerHTML = '<input /><textarea></textarea><select></select><iframe></iframe>';
    const els = Array.from(document.body.children);
    els.forEach((el, i) => stubRect(el, { x: 10, y: 10 + i * 30, width: 100, height: 20 }));

    const boxes = shotMaskRects(document, crop);

    expect(boxes).toEqual([
      { x: 10, y: 10, width: 100, height: 20 },
      { x: 10, y: 40, width: 100, height: 20 },
      { x: 10, y: 70, width: 100, height: 20 },
      { x: 10, y: 100, width: 100, height: 20 },
    ]);
  });

  it('returns a box for a data-passback-mask element and for a contenteditable area', () => {
    document.body.innerHTML =
      '<div data-passback-mask>a</div><div contenteditable="true">b</div><div contenteditable="false">c</div>';
    const [a, b, c] = Array.from(document.body.children);
    stubRect(a!, { x: 0, y: 0, width: 50, height: 10 });
    stubRect(b!, { x: 0, y: 20, width: 60, height: 10 });
    stubRect(c!, { x: 0, y: 40, width: 70, height: 10 });

    expect(shotMaskRects(document, crop)).toEqual([
      { x: 0, y: 0, width: 50, height: 10 },
      { x: 0, y: 20, width: 60, height: 10 },
    ]);
  });

  it('clips a box to the crop and makes it relative to the crop origin', () => {
    document.body.innerHTML = '<input />';
    stubRect(document.body.firstElementChild!, { x: 80, y: 90, width: 100, height: 100 });

    expect(shotMaskRects(document, { x: 100, y: 100, width: 50, height: 200 })).toEqual([
      { x: 0, y: 0, width: 50, height: 90 },
    ]);
  });

  it('skips elements outside the crop and elements with no size', () => {
    document.body.innerHTML = '<input /><input /><input />';
    const [a, b, c] = Array.from(document.body.children);
    stubRect(a!, { x: 600, y: 0, width: 50, height: 20 });
    stubRect(b!, { x: 10, y: 10, width: 0, height: 20 });
    stubRect(c!, { x: 10, y: 10, width: 20, height: 0 });

    expect(shotMaskRects(document, crop)).toEqual([]);
  });

  it('finds inputs inside an open shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input />';
    stubRect(shadow.firstElementChild!, { x: 5, y: 6, width: 30, height: 10 });

    expect(shotMaskRects(document, crop)).toEqual([{ x: 5, y: 6, width: 30, height: 10 }]);
  });

  it('leaves out the skipped element and everything in its shadow root', () => {
    document.body.innerHTML = '<div data-passback-mask></div><input />';
    const [host, input] = Array.from(document.body.children);
    const shadow = host!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<textarea></textarea>';
    stubRect(host!, { x: 10, y: 10, width: 100, height: 100 });
    stubRect(shadow.firstElementChild!, { x: 20, y: 20, width: 80, height: 40 });
    stubRect(input!, { x: 5, y: 6, width: 30, height: 10 });

    expect(shotMaskRects(document, crop, host!)).toEqual([{ x: 5, y: 6, width: 30, height: 10 }]);
  });

  it('still masks a field in the light DOM under the skipped element', () => {
    document.body.innerHTML = '<div data-passback-mask><input /></div>';
    const host = document.body.firstElementChild!;
    stubRect(host, { x: 10, y: 10, width: 100, height: 100 });
    stubRect(host.firstElementChild!, { x: 5, y: 6, width: 30, height: 10 });

    expect(shotMaskRects(document, crop, host)).toEqual([{ x: 5, y: 6, width: 30, height: 10 }]);
  });

  it('rounds a box outward to whole pixels', () => {
    document.body.innerHTML = '<input />';
    stubRect(document.body.firstElementChild!, { x: 10.4, y: 20.6, width: 30.2, height: 10.1 });

    expect(shotMaskRects(document, crop)).toEqual([{ x: 10, y: 20, width: 31, height: 11 }]);
  });
});
