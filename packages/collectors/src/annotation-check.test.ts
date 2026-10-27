import { describe, expect, it } from 'vitest';
import type { Annotation, Rect } from '@passback/schema';
import { ANNOTATION_TOLERANCE, checkAnnotation } from './annotation-check';

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('checkAnnotation', () => {
  it('holds an align when the two left edges are within the tolerance', () => {
    const annotation: Annotation = {
      type: 'align',
      edge: 'left',
      a: 'a',
      b: 'b',
      actual: { a: 0, b: 0 },
    };
    const rects = { a: rect(10, 0, 50, 20), b: rect(10.5, 100, 30, 10) };

    const result = checkAnnotation(annotation, rects);

    expect(result).toEqual({ checked: true, holds: true, actual: 0.5 });
  });

  it('fails an align on the bottom edges and reports the distance', () => {
    const annotation: Annotation = {
      type: 'align',
      edge: 'bottom',
      a: 'a',
      b: 'b',
      actual: { a: 0, b: 0 },
    };
    const rects = { a: rect(0, 0, 10, 20), b: rect(0, 0, 10, 30) };

    const result = checkAnnotation(annotation, rects);

    expect(result).toEqual({ checked: true, holds: false, actual: 10 });
  });

  it('measures a gap between horizontally separated rects', () => {
    const annotation: Annotation = { type: 'gap', a: 'a', b: 'b', expected: 20, actual: 0 };
    const rects = { a: rect(0, 0, 10, 10), b: rect(30, 0, 10, 10) };

    const result = checkAnnotation(annotation, rects);

    expect(result).toEqual({ checked: true, holds: true, actual: 20 });
  });

  it('measures a gap between vertically separated rects', () => {
    const annotation: Annotation = { type: 'gap', a: 'a', b: 'b', expected: 15, actual: 0 };
    const rects = { a: rect(0, 0, 10, 10), b: rect(0, 25, 10, 10) };

    const result = checkAnnotation(annotation, rects);

    expect(result).toEqual({ checked: true, holds: true, actual: 15 });
  });

  it('reports a negative gap when the rects overlap', () => {
    const annotation: Annotation = { type: 'gap', a: 'a', b: 'b', expected: -10, actual: 0 };
    const rects = { a: rect(0, 0, 20, 20), b: rect(10, 10, 20, 20) };

    const result = checkAnnotation(annotation, rects);

    expect(result).toEqual({ checked: true, holds: true, actual: -10 });
  });

  it('holds a no-overlap for rects that only touch', () => {
    const annotation: Annotation = { type: 'no-overlap', elements: ['a', 'b'] };
    const rects = { a: rect(0, 0, 10, 10), b: rect(10, 0, 10, 10) };

    const result = checkAnnotation(annotation, rects);

    expect(result).toEqual({ checked: true, holds: true, actual: 0 });
  });

  it('fails a no-overlap and counts the overlapping pairs', () => {
    const annotation: Annotation = { type: 'no-overlap', elements: ['a', 'b', 'c'] };
    const rects = {
      a: rect(0, 0, 20, 20),
      b: rect(10, 10, 20, 20),
      c: rect(15, 15, 20, 20),
    };

    const result = checkAnnotation(annotation, rects);

    expect(result).toEqual({ checked: true, holds: false, actual: 3 });
  });

  it('is unchecked when a named rect is missing', () => {
    const annotation: Annotation = {
      type: 'align',
      edge: 'left',
      a: 'a',
      b: 'missing',
      actual: { a: 0, b: 0 },
    };
    const rects = { a: rect(0, 0, 10, 10) };

    expect(checkAnnotation(annotation, rects)).toEqual({ checked: false });
  });

  it('is unchecked for move, arrow, box and label', () => {
    const rects = { a: rect(0, 0, 10, 10), b: rect(0, 0, 10, 10) };
    const move: Annotation = { type: 'move', element: 'a', target: 'b' };
    const arrow: Annotation = { type: 'arrow' };
    const box: Annotation = { type: 'box' };
    const label: Annotation = { type: 'label' };

    expect(checkAnnotation(move, rects)).toEqual({ checked: false });
    expect(checkAnnotation(arrow, rects)).toEqual({ checked: false });
    expect(checkAnnotation(box, rects)).toEqual({ checked: false });
    expect(checkAnnotation(label, rects)).toEqual({ checked: false });
  });

  it('honours a custom tolerance', () => {
    const annotation: Annotation = {
      type: 'align',
      edge: 'left',
      a: 'a',
      b: 'b',
      actual: { a: 0, b: 0 },
    };
    const rects = { a: rect(0, 0, 10, 10), b: rect(3, 0, 10, 10) };

    expect(checkAnnotation(annotation, rects, ANNOTATION_TOLERANCE)).toEqual({
      checked: true,
      holds: false,
      actual: 3,
    });
    expect(checkAnnotation(annotation, rects, 5)).toEqual({
      checked: true,
      holds: true,
      actual: 3,
    });
  });
});
