import { describe, expect, it } from 'vitest';
import { orphanedIds, reattachMarks, type OpenMark, type Reattached } from './reattach';

function fakeElement(): Element {
  return {} as Element;
}

describe('reattachMarks', () => {
  it('returns one result per mark in input order', () => {
    const marks: OpenMark[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const elements = new Map<string, Element>([
      ['a', fakeElement()],
      ['b', fakeElement()],
      ['c', fakeElement()],
    ]);

    const results = reattachMarks(marks, (mark) => elements.get(mark.id) ?? null);

    expect(results.map((result) => result.mark.id)).toEqual(['a', 'b', 'c']);
  });

  it('marks a mark orphaned when its element no longer resolves', () => {
    const marks: OpenMark[] = [{ id: 'gone' }];

    const results = reattachMarks(marks, () => null);

    expect(results).toEqual([{ mark: marks[0], element: null, orphaned: true }]);
  });

  it('keeps the same mark object and id when the element is found again', () => {
    const mark: OpenMark = { id: 'found' };
    const element = fakeElement();

    const results = reattachMarks([mark], () => element);

    expect(results).toEqual([{ mark, element, orphaned: false }]);
    expect(results[0]?.mark).toBe(mark);
  });

  it('a resolver that throws orphans only that mark', () => {
    const marks: OpenMark[] = [{ id: 'ok' }, { id: 'throws' }];
    const element = fakeElement();

    const results = reattachMarks(marks, (mark) => {
      if (mark.id === 'throws') throw new Error('boom');
      return element;
    });

    expect(results).toEqual([
      { mark: marks[0], element, orphaned: false },
      { mark: marks[1], element: null, orphaned: true },
    ]);
  });

  it('an empty list gives an empty list', () => {
    const results = reattachMarks([], () => fakeElement());

    expect(results).toEqual([]);
  });

  it('orphanedIds lists the orphaned marks in order', () => {
    const results: Reattached<OpenMark>[] = [
      { mark: { id: 'a' }, element: fakeElement(), orphaned: false },
      { mark: { id: 'b' }, element: null, orphaned: true },
      { mark: { id: 'c' }, element: fakeElement(), orphaned: false },
      { mark: { id: 'd' }, element: null, orphaned: true },
    ];

    expect(orphanedIds(results)).toEqual(['b', 'd']);
  });
});
