// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  acceptShape,
  pushShape,
  shapePath,
  shiftShapes,
  undoShape,
  SHAPE_MAX,
  type Shape,
} from './shot-shapes';

function line(x1: number, y1: number, x2: number, y2: number): Shape {
  return { tool: 'line', from: { x: x1, y: y1 }, to: { x: x2, y: y2 } };
}

describe('shot-shapes', () => {
  it('accepts a shape only when its two points are at least 6 px apart', () => {
    expect(acceptShape(line(0, 0, 3, 4))).toBe(false);
    expect(acceptShape(line(0, 0, 6, 0))).toBe(true);
  });

  it('appends an accepted shape and returns a new array', () => {
    const list: readonly Shape[] = [line(0, 0, 10, 0)];
    const next = pushShape(list, line(0, 0, 0, 10));
    expect(next).not.toBe(list);
    expect(next).toEqual([line(0, 0, 10, 0), line(0, 0, 0, 10)]);
    expect(list).toHaveLength(1);
  });

  it('ignores a shape when the list already holds 20', () => {
    const full: readonly Shape[] = Array.from({ length: SHAPE_MAX }, (_, i) => line(0, i, 10, i));
    expect(pushShape(full, line(0, 0, 50, 50))).toBe(full);
  });

  it('ignores a shape shorter than 6 px and returns the same list', () => {
    const list: readonly Shape[] = [line(0, 0, 10, 0)];
    expect(pushShape(list, line(0, 0, 3, 4))).toBe(list);
  });

  it('undoes the last shape and leaves the input untouched', () => {
    const list: readonly Shape[] = [line(0, 0, 10, 0), line(0, 0, 0, 10)];
    const next = undoShape(list);
    expect(next).toEqual([line(0, 0, 10, 0)]);
    expect(list).toHaveLength(2);
    expect(undoShape([])).toEqual([]);
  });

  it('moves every point by the shift and returns the same list for a zero shift', () => {
    const list: readonly Shape[] = [line(10, 20, 30, 40)];
    expect(shiftShapes(list, 0, -15)).toEqual([line(10, 5, 30, 25)]);
    expect(list).toEqual([line(10, 20, 30, 40)]);
    expect(shiftShapes(list, 0, 0)).toBe(list);
  });

  it('writes a line and a box as path data', () => {
    expect(shapePath(line(10, 20, 110, 20))).toBe('M10 20L110 20');
    expect(shapePath({ tool: 'box', from: { x: 30, y: 40 }, to: { x: 10, y: 5 } })).toBe(
      'M10 5H30V40H10Z',
    );
  });

  it('writes an arrow with its two wings, scaled by k', () => {
    const arrow: Shape = { tool: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    expect(shapePath(arrow)).toBe('M0 0L100 0M100 0L92.1 4.3M100 0L92.1 -4.3');
    expect(shapePath(arrow, 2)).toBe('M0 0L200 0M200 0L184.2 8.6M200 0L184.2 -8.6');
  });
});
