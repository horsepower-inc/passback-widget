// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Visual } from '@passback/schema';
import { collectText, TEXT_LINES_MAX } from './text';

const MARK_MAX_BYTES = 50 * 1024;

function stubRects(rects: Array<{ x: number; y: number; width: number; height: number }>) {
  const domRects = rects.map((r) => ({
    ...r,
    top: r.y,
    left: r.x,
    right: r.x + r.width,
    bottom: r.y + r.height,
  })) as unknown as DOMRectList;
  vi.spyOn(document, 'createRange').mockReturnValue({
    selectNodeContents: () => {},
    getClientRects: () => domRects,
  } as unknown as Range);
}

function lineRects(count: number, fragmentsPerLine = 1) {
  const rects = [];
  for (let i = 0; i < count; i++) {
    for (let f = 0; f < fragmentsPerLine; f++) {
      rects.push({ x: f * 30, y: i * 20, width: 25, height: 16 });
    }
  }
  return rects;
}

function collect(rects: ReturnType<typeof lineRects>) {
  document.body.innerHTML = '<p id="el">text</p>';
  stubRects(rects);
  return collectText(document.getElementById('el')!, () => ({ ascent: 12, descent: 4 }));
}

describe('collectText line cap', () => {
  it('a block of thousands of text lines keeps the first lines and stays small', () => {
    const text = collect(lineRects(3000));

    expect(text?.lines).toHaveLength(TEXT_LINES_MAX);
    expect(text?.lines?.[0]).toEqual({ x: 0, y: 0, width: 25, height: 16 });
    expect(text?.lines?.map((l) => l.y)).toEqual(
      Array.from({ length: TEXT_LINES_MAX }, (_, i) => i * 20),
    );
    expect(text?.baseline).toBe(12);
    expect(JSON.stringify(text).length).toBeLessThan(MARK_MAX_BYTES / 2);
  });

  it('a block at the cap keeps every line', () => {
    expect(collect(lineRects(TEXT_LINES_MAX))?.lines).toHaveLength(TEXT_LINES_MAX);
    expect(collect(lineRects(TEXT_LINES_MAX - 1))?.lines).toHaveLength(TEXT_LINES_MAX - 1);
  });

  it('the cap counts merged lines, not fragments', () => {
    const text = collect(lineRects(TEXT_LINES_MAX, 3));

    expect(text?.lines).toHaveLength(TEXT_LINES_MAX);
    expect(text?.lines?.[0]).toEqual({ x: 0, y: 0, width: 85, height: 16 });
  });

  it('a capped list still validates against the schema Visual text', () => {
    const text = collect(lineRects(3000));

    expect(Visual.shape.text.safeParse(text).success).toBe(true);
  });
});
