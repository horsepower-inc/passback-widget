import { describe, expect, it } from 'vitest';
import type { Annotation, Rect } from '@passback/schema';
import { assertionFile, failedAssertions, parseAssertionFile } from './assertions';

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

const align: Annotation = {
  type: 'align',
  edge: 'left',
  a: 'a',
  b: 'b',
  actual: { a: 0, b: 0 },
};

const gap: Annotation = { type: 'gap', a: 'a', b: 'b', expected: 20, actual: 20 };

const noOverlap: Annotation = { type: 'no-overlap', elements: ['a', 'b'] };

const move: Annotation = { type: 'move', element: 'a', target: 'b' };

const arrow: Annotation = { type: 'arrow' };

describe('assertionFile', () => {
  it('keeps only the geometric annotations, in order', () => {
    const result = assertionFile('mark-1', [move, align, arrow, gap, noOverlap], [1024, 768]);

    expect(result).toBeDefined();
    const file = parseAssertionFile(result!.text);
    expect(file.annotations).toEqual([align, gap, noOverlap]);
  });

  it('returns undefined when no annotation is geometric', () => {
    const result = assertionFile('mark-1', [move, arrow], [1024, 768]);

    expect(result).toBeUndefined();
  });

  it('names the file after the mark id', () => {
    const result = assertionFile('mark-1', [align], [1024, 768]);

    expect(result?.name).toBe('mark-1.json');
  });

  it('rejects a mark id that is not filename safe', () => {
    expect(() => assertionFile('mark/1', [align], [1024, 768])).toThrow(/^invalid mark id:/);
  });

  it('round-trips through parseAssertionFile', () => {
    const result = assertionFile('mark-1', [align, gap], [1024, 768]);

    const file = parseAssertionFile(result!.text);

    expect(file).toEqual({
      v: 1,
      markId: 'mark-1',
      viewport: [1024, 768],
      annotations: [align, gap],
    });
  });

  it('rejects text that is not an assertion file', () => {
    expect(() => parseAssertionFile('not json')).toThrow(/^invalid assertion file:/);
    expect(() => parseAssertionFile('null')).toThrow(/^invalid assertion file:/);
    expect(() => parseAssertionFile('[]')).toThrow(/^invalid assertion file:/);
    expect(() =>
      parseAssertionFile(JSON.stringify({ v: 2, markId: 'a', viewport: [1, 1], annotations: [] })),
    ).toThrow(/^invalid assertion file:/);
    expect(() =>
      parseAssertionFile(JSON.stringify({ v: 1, markId: 1, viewport: [1, 1], annotations: [] })),
    ).toThrow(/^invalid assertion file:/);
    expect(() =>
      parseAssertionFile(JSON.stringify({ v: 1, markId: 'a', viewport: [1], annotations: [] })),
    ).toThrow(/^invalid assertion file:/);
    expect(() =>
      parseAssertionFile(
        JSON.stringify({ v: 1, markId: 'a', viewport: [1, 1], annotations: [{ type: 'arrow' }] }),
      ),
    ).toThrow(/^invalid assertion file:/);
  });

  it('reports the assertions that no longer hold with their actual value', () => {
    const result = assertionFile('mark-1', [align, gap], [1024, 768]);
    const file = parseAssertionFile(result!.text);
    const rects = { a: rect(0, 0, 10, 10), b: rect(30, 0, 10, 10) };

    const failures = failedAssertions(file, rects);

    expect(failures).toEqual([{ annotation: align, actual: 30 }]);
  });

  it('reports nothing when every assertion holds', () => {
    const result = assertionFile('mark-1', [align, gap], [1024, 768]);
    const file = parseAssertionFile(result!.text);
    const rects = { a: rect(0, 0, 10, 10), b: rect(0.5, 30, 10, 10) };

    const failures = failedAssertions(file, rects);

    expect(failures).toEqual([]);
  });

  it('skips an assertion whose element is missing from the rects', () => {
    const result = assertionFile('mark-1', [align], [1024, 768]);
    const file = parseAssertionFile(result!.text);
    const rects = { a: rect(0, 0, 10, 10) };

    const failures = failedAssertions(file, rects);

    expect(failures).toEqual([]);
  });
});
