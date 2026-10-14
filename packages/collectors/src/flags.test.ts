// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Visual } from '@passback/schema';
import { collectFlags } from './flags';

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

function stubOverflow(
  el: Element,
  size: { scrollWidth: number; clientWidth: number; scrollHeight?: number; clientHeight?: number },
) {
  Object.defineProperty(el, 'scrollWidth', { value: size.scrollWidth, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: size.clientWidth, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: size.scrollHeight ?? 0, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: size.clientHeight ?? 0, configurable: true });
}

describe('collectFlags clipped', () => {
  it('flags a title whose text overflows its hidden-overflow box', () => {
    document.body.innerHTML =
      '<div id="el" style="overflow-x: hidden; overflow-y: visible;">Title text that overflows</div>';
    const el = document.getElementById('el')!;
    stubRect(el, { x: 0, y: 0, width: 100, height: 20 });
    stubOverflow(el, { scrollWidth: 200, clientWidth: 100 });

    expect(collectFlags(el).clipped).toBe(true);
  });

  it('does not flag overflow on an element with visible overflow', () => {
    document.body.innerHTML =
      '<div id="el" style="overflow-x: visible; overflow-y: visible;">Title text that overflows</div>';
    const el = document.getElementById('el')!;
    stubRect(el, { x: 0, y: 0, width: 100, height: 20 });
    stubOverflow(el, { scrollWidth: 200, clientWidth: 100 });

    expect(collectFlags(el).clipped).toBe(false);
  });

  it('flags an element cut off by a hidden-overflow ancestor', () => {
    document.body.innerHTML =
      '<div id="ancestor" style="overflow-x: hidden; overflow-y: hidden;"><span id="el">clipped</span></div>';
    const ancestor = document.getElementById('ancestor')!;
    const el = document.getElementById('el')!;
    stubRect(ancestor, { x: 0, y: 0, width: 100, height: 100 });
    stubRect(el, { x: 50, y: 0, width: 100, height: 20 });
    stubOverflow(el, { scrollWidth: 100, clientWidth: 100, scrollHeight: 20, clientHeight: 20 });

    expect(collectFlags(el).clipped).toBe(true);
  });

  it('does not flag overflow on the visible axis when only the other axis overflows', () => {
    document.body.innerHTML =
      '<div id="el" style="overflow-x: clip; overflow-y: visible;">Title text that overflows</div>';
    const el = document.getElementById('el')!;
    stubRect(el, { x: 0, y: 0, width: 100, height: 20 });
    stubOverflow(el, { scrollWidth: 100, clientWidth: 100, scrollHeight: 200, clientHeight: 100 });

    expect(collectFlags(el).clipped).toBe(false);
  });

  it('does not flag an ancestor whose clipped axis is not the axis the element escapes', () => {
    document.body.innerHTML =
      '<div id="ancestor" style="overflow-x: visible; overflow-y: clip;"><span id="el">clipped</span></div>';
    const ancestor = document.getElementById('ancestor')!;
    const el = document.getElementById('el')!;
    stubRect(ancestor, { x: 0, y: 0, width: 100, height: 100 });
    stubRect(el, { x: 150, y: 10, width: 50, height: 20 });
    stubOverflow(el, { scrollWidth: 50, clientWidth: 50, scrollHeight: 20, clientHeight: 20 });

    expect(collectFlags(el).clipped).toBe(false);
  });
});

describe('collectFlags covered', () => {
  it('flags covered when another element sits on the centre', () => {
    document.body.innerHTML = '<div id="el">badge</div><div id="cover">overlap</div>';
    const el = document.getElementById('el')!;
    const cover = document.getElementById('cover')!;
    stubRect(el, { x: 100, y: 100, width: 40, height: 20 });
    stubOverflow(el, { scrollWidth: 40, clientWidth: 40, scrollHeight: 20, clientHeight: 20 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(cover);

    expect(collectFlags(el).covered).toBe(true);
  });

  it('does not flag covered when the hit is a descendant', () => {
    document.body.innerHTML = '<div id="el">badge<span id="inner">x</span></div>';
    const el = document.getElementById('el')!;
    const inner = document.getElementById('inner')!;
    stubRect(el, { x: 100, y: 100, width: 40, height: 20 });
    stubOverflow(el, { scrollWidth: 40, clientWidth: 40, scrollHeight: 20, clientHeight: 20 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(inner);

    expect(collectFlags(el).covered).toBe(false);
  });

  it('does not flag covered for an element fully outside the viewport', () => {
    document.body.innerHTML = '<div id="el">badge</div>';
    const el = document.getElementById('el')!;
    stubRect(el, { x: -5000, y: -5000, width: 40, height: 20 });
    stubOverflow(el, { scrollWidth: 40, clientWidth: 40, scrollHeight: 20, clientHeight: 20 });
    const spy = vi.spyOn(document, 'elementFromPoint');

    expect(collectFlags(el).covered).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not flag covered by a sibling that sits behind the mark in the stack', () => {
    document.body.innerHTML = '<div id="el">badge</div><div id="siblingBehind">deco</div>';
    const el = document.getElementById('el')!;
    const siblingBehind = document.getElementById('siblingBehind')!;
    const body = document.body;
    const html = document.documentElement;
    stubRect(el, { x: 100, y: 100, width: 40, height: 20 });
    stubOverflow(el, { scrollWidth: 40, clientWidth: 40, scrollHeight: 20, clientHeight: 20 });
    const elementsFromPoint = vi.fn().mockReturnValue([el, siblingBehind, body, html]);
    (document as unknown as { elementsFromPoint: typeof elementsFromPoint }).elementsFromPoint =
      elementsFromPoint;

    try {
      expect(collectFlags(el).covered).toBe(false);
    } finally {
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });

  it('does not flag covered for an unobscured mark with pointer-events: none', () => {
    document.body.innerHTML = '<div id="el" style="pointer-events: none;">badge</div>';
    const el = document.getElementById('el')!;
    const body = document.body;
    const html = document.documentElement;
    stubRect(el, { x: 100, y: 100, width: 40, height: 20 });
    stubOverflow(el, { scrollWidth: 40, clientWidth: 40, scrollHeight: 20, clientHeight: 20 });
    // A real browser excludes pointer-events: none elements from elementsFromPoint entirely,
    // so `el` never appears in the stack even though nothing actually covers it.
    const elementsFromPoint = vi.fn().mockReturnValue([body, html]);
    (document as unknown as { elementsFromPoint: typeof elementsFromPoint }).elementsFromPoint =
      elementsFromPoint;

    try {
      expect(collectFlags(el).covered).toBe(false);
    } finally {
      delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    }
  });
});

describe('collectFlags offViewport', () => {
  it('flags offViewport when the right edge passes the viewport', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 375,
      configurable: true,
    });
    document.body.innerHTML = '<div id="el">CTA</div>';
    const el = document.getElementById('el')!;
    stubRect(el, { x: 340, y: 100, width: 60, height: 20 });
    stubOverflow(el, { scrollWidth: 60, clientWidth: 60, scrollHeight: 20, clientHeight: 20 });

    expect(collectFlags(el).offViewport).toBe(true);
  });

  it('does not flag an element below the fold', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 375,
      configurable: true,
    });
    document.body.innerHTML = '<div id="el">below the fold</div>';
    const el = document.getElementById('el')!;
    stubRect(el, { x: 10, y: 5000, width: 60, height: 20 });
    stubOverflow(el, { scrollWidth: 60, clientWidth: 60, scrollHeight: 20, clientHeight: 20 });

    expect(collectFlags(el).offViewport).toBe(false);
  });
});

describe('collectFlags schema', () => {
  it('validates against the schema Visual flags', () => {
    document.body.innerHTML = '<div id="el">text</div>';
    const el = document.getElementById('el')!;
    stubRect(el, { x: 0, y: 0, width: 40, height: 20 });
    stubOverflow(el, { scrollWidth: 40, clientWidth: 40, scrollHeight: 20, clientHeight: 20 });

    const flags = collectFlags(el);

    expect(() => Visual.shape.flags.parse(flags)).not.toThrow();
  });
});
