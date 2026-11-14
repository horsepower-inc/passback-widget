import { describe, expect, it } from 'vitest';
import type { Annotation, Rect } from '@passback/schema';
import { autoVerify } from './auto-verify';

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

describe('autoVerify', () => {
  it('closes a mark whose align, gap and no-overlap annotations all hold', () => {
    const annotations: Annotation[] = [
      { type: 'align', edge: 'left', a: 'a', b: 'b', actual: { a: 0, b: 0 } },
      { type: 'gap', a: 'a', b: 'c', expected: 20, actual: 0 },
      { type: 'no-overlap', elements: ['b', 'c'] },
    ];
    const rectsAfter = { a: rect(0, 0, 10, 10), b: rect(0, 40, 10, 10), c: rect(30, 0, 10, 10) };

    const result = autoVerify(annotations, rectsAfter);

    expect(result).toEqual({ verdict: 'closed', failed: [] });
  });

  it('stays open and reports the actual value of a gap that no longer holds', () => {
    const annotation: Annotation = { type: 'gap', a: 'a', b: 'b', expected: 20, actual: 0 };
    const rectsAfter = { a: rect(0, 0, 10, 10), b: rect(15, 0, 10, 10) };

    const result = autoVerify([annotation], rectsAfter);

    expect(result).toEqual({ verdict: 'open', failed: [{ annotation, actual: 5 }] });
  });

  it('stays open even when another annotation cannot be checked', () => {
    const failing: Annotation = { type: 'gap', a: 'a', b: 'b', expected: 20, actual: 0 };
    const move: Annotation = { type: 'move', element: 'a', target: 'b' };
    const rectsAfter = { a: rect(0, 0, 10, 10), b: rect(15, 0, 10, 10) };

    const result = autoVerify([failing, move], rectsAfter);

    expect(result).toEqual({ verdict: 'open', failed: [{ annotation: failing, actual: 5 }] });
  });

  it('is unchecked when a named rect is missing after the update', () => {
    const annotation: Annotation = {
      type: 'align',
      edge: 'left',
      a: 'a',
      b: 'missing',
      actual: { a: 0, b: 0 },
    };
    const rectsAfter = { a: rect(0, 0, 10, 10) };

    const result = autoVerify([annotation], rectsAfter);

    expect(result).toEqual({ verdict: 'unchecked', failed: [] });
  });

  it('is unchecked for a move annotation', () => {
    const annotation: Annotation = { type: 'move', element: 'a', target: 'b' };
    const rectsAfter = { a: rect(0, 0, 10, 10), b: rect(20, 0, 10, 10) };

    const result = autoVerify([annotation], rectsAfter);

    expect(result).toEqual({ verdict: 'unchecked', failed: [] });
  });

  it('ignores arrow, box and label annotations', () => {
    const annotations: Annotation[] = [
      { type: 'align', edge: 'left', a: 'a', b: 'b', actual: { a: 0, b: 0 } },
      { type: 'arrow' },
      { type: 'box' },
      { type: 'label' },
    ];
    const rectsAfter = { a: rect(0, 0, 10, 10), b: rect(0, 0, 10, 10) };

    const result = autoVerify(annotations, rectsAfter);

    expect(result).toEqual({ verdict: 'closed', failed: [] });
  });

  it('is unchecked when the mark has no annotation to check', () => {
    const result = autoVerify([], {});

    expect(result).toEqual({ verdict: 'unchecked', failed: [] });
  });

  it('passes the tolerance through to the check', () => {
    const annotation: Annotation = {
      type: 'align',
      edge: 'left',
      a: 'a',
      b: 'b',
      actual: { a: 0, b: 0 },
    };
    const rectsAfter = { a: rect(0, 0, 10, 10), b: rect(3, 0, 10, 10) };

    expect(autoVerify([annotation], rectsAfter)).toEqual({
      verdict: 'open',
      failed: [{ annotation, actual: 3 }],
    });
    expect(autoVerify([annotation], rectsAfter, 5)).toEqual({ verdict: 'closed', failed: [] });
  });
});
