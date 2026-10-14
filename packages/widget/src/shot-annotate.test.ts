// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { toAnnotations } from './shot-annotate';
import type { Shape } from './shot-shapes';

const rect = { left: 200, top: 100 };

describe('toAnnotations', () => {
  it('turns an arrow into an arrow annotation relative to the element corner', () => {
    const shapes: Shape[] = [{ tool: 'arrow', from: { x: 300, y: 140 }, to: { x: 220.26, y: 118.04 } }];
    expect(toAnnotations(shapes, rect)).toEqual([
      { type: 'arrow', from: { x: 100, y: 40 }, to: { x: 20.3, y: 18 } },
    ]);
  });

  it('turns a box into a box annotation and keeps negative offsets', () => {
    const shapes: Shape[] = [{ tool: 'box', from: { x: 190, y: 90 }, to: { x: 260, y: 150 } }];
    expect(toAnnotations(shapes, rect)).toEqual([
      { type: 'box', from: { x: -10, y: -10 }, to: { x: 60, y: 50 } },
    ]);
  });

  it('rounds offsets to one decimal', () => {
    const shapes: Shape[] = [{ tool: 'box', from: { x: 200.04, y: 100.06 }, to: { x: 233.33, y: 166.67 } }];
    expect(toAnnotations(shapes, rect)).toEqual([
      { type: 'box', from: { x: 0, y: 0.1 }, to: { x: 33.3, y: 66.7 } },
    ]);
  });

  it('leaves a line out', () => {
    const shapes: Shape[] = [{ tool: 'line', from: { x: 210, y: 110 }, to: { x: 250, y: 150 } }];
    expect(toAnnotations(shapes, rect)).toEqual([]);
  });

  it('keeps the drawing order and adds no text key', () => {
    const shapes: Shape[] = [
      { tool: 'box', from: { x: 210, y: 110 }, to: { x: 250, y: 150 } },
      { tool: 'line', from: { x: 0, y: 0 }, to: { x: 50, y: 50 } },
      { tool: 'arrow', from: { x: 300, y: 200 }, to: { x: 250, y: 150 } },
    ];
    const out = toAnnotations(shapes, rect);
    expect(out.map((a) => a.type)).toEqual(['box', 'arrow']);
    for (const a of out) expect(Object.keys(a).sort()).toEqual(['from', 'to', 'type']);
  });

  it('returns an empty list for no shapes', () => {
    expect(toAnnotations([], rect)).toEqual([]);
  });
});
