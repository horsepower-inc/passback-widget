import { describe, expect, it } from 'vitest';
import type { Rect } from '@passback/schema';
import {
  WIREFRAME_LABEL_MAX,
  WIREFRAME_MAX_BYTES,
  WIREFRAME_MARGIN,
  renderWireframe,
} from './wireframe';

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('renderWireframe', () => {
  it('draws self, parent and both siblings as rects with a data-role', () => {
    const svg = renderWireframe({
      rects: {
        self: rect(100, 10, 50, 20),
        parent: rect(0, 0, 300, 100),
        prev: rect(10, 10, 50, 20),
        next: rect(200, 10, 50, 20),
      },
    });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('data-role="parent"');
    expect(svg).toContain('data-role="prev"');
    expect(svg).toContain('data-role="next"');
    expect(svg).toContain('data-role="self"');
  });

  it('draws nothing for siblings and a positioned rect that are absent', () => {
    const svg = renderWireframe({
      rects: {
        self: rect(100, 10, 50, 20),
        parent: rect(0, 0, 300, 100),
      },
    });

    expect(svg).not.toContain('data-role="prev"');
    expect(svg).not.toContain('data-role="next"');
    expect(svg).not.toContain('data-role="positioned"');
  });

  it('sizes the viewBox to the union of the rects plus a 16 px margin', () => {
    const svg = renderWireframe({
      rects: {
        self: rect(100, 10, 50, 20),
        parent: rect(0, 0, 300, 100),
      },
    });

    const minX = 0 - WIREFRAME_MARGIN;
    const minY = 0 - WIREFRAME_MARGIN;
    const width = 300 + WIREFRAME_MARGIN * 2;
    const height = 100 + WIREFRAME_MARGIN * 2;

    expect(svg).toContain(`viewBox="${minX} ${minY} ${width} ${height}"`);
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
  });

  it('labels the marked element with its width and height', () => {
    const svg = renderWireframe({
      rects: {
        self: rect(100, 10, 50.5, 20.25),
        parent: rect(0, 0, 300, 100),
      },
    });

    expect(svg).toContain('<text data-role="dimensions"');
    expect(svg).toContain('>50.5x20.25<');
  });

  it('escapes XML characters in the selector label', () => {
    const svg = renderWireframe({
      rects: {
        self: rect(100, 10, 50, 20),
        parent: rect(0, 0, 300, 100),
      },
      selector: '<div class="a&b">',
    });

    expect(svg).toContain('&lt;div class=&quot;a&amp;b&quot;&gt;');
    expect(svg).not.toContain('<div class="a&b">');
  });

  it('truncates a long selector label', () => {
    const longSelector = 'a'.repeat(200);
    const svg = renderWireframe({
      rects: {
        self: rect(100, 10, 50, 20),
        parent: rect(0, 0, 300, 100),
      },
      selector: longSelector,
    });

    expect(svg).toContain('a'.repeat(WIREFRAME_LABEL_MAX));
    expect(svg).not.toContain('a'.repeat(WIREFRAME_LABEL_MAX + 1));
  });

  it('returns identical text for identical input', () => {
    const input = {
      rects: {
        self: rect(100, 10, 50, 20),
        parent: rect(0, 0, 300, 100),
        prev: rect(10, 10, 50, 20),
        next: rect(200, 10, 50, 20),
        positioned: rect(0, 0, 500, 500),
      },
      selector: '#foo > .bar',
    };

    const first = renderWireframe(input);
    const second = renderWireframe(input);

    expect(first).toBe(second);
  });

  it('stays under 20 KB', () => {
    const svg = renderWireframe({
      rects: {
        self: rect(100, 10, 50, 20),
        parent: rect(0, 0, 300, 100),
        prev: rect(10, 10, 50, 20),
        next: rect(200, 10, 50, 20),
        positioned: rect(0, 0, 500, 500),
      },
      selector: 'a'.repeat(WIREFRAME_LABEL_MAX),
    });

    expect(new TextEncoder().encode(svg).length).toBeLessThanOrEqual(WIREFRAME_MAX_BYTES);
  });
});
