// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { KEPT_MAX, emptyKept, keptFull, keptReducer, numbered } from './kept';
import type { Kept, KeptComment } from './kept';

function make(comment: string): KeptComment {
  return {
    element: document.createElement('div'),
    selector: 'div',
    offset: { x: 0.5, y: 0.5 } as KeptComment['offset'],
    comment,
  };
}

function keep(...comments: string[]): Kept {
  return comments.reduce<Kept>((s, c) => keptReducer(s, { type: 'add', item: make(c) }), emptyKept());
}

describe('kept comments', () => {
  it('starts empty and is not full', () => {
    const s = emptyKept();
    expect(s.items).toEqual([]);
    expect(keptFull(s)).toBe(false);
    expect(numbered(s)).toEqual([]);
  });

  it('adds a comment and numbers the list from 1 in the order kept', () => {
    const s = keep('a', 'b', 'c');
    expect(numbered(s).map((e) => [e.n, e.item.comment])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('refuses the twenty-first comment and returns the same state', () => {
    const s = keep(...Array.from({ length: 20 }, (_, i) => `c${i}`));
    expect(keptFull(s)).toBe(true);
    const next = keptReducer(s, { type: 'add', item: make('one more') });
    expect(next).toBe(s);
    expect(next.items.length).toBe(20);
  });

  it('refuses a blank comment', () => {
    const s = keep('a');
    expect(keptReducer(s, { type: 'add', item: make('   \n') })).toBe(s);
    expect(keptReducer(s, { type: 'add', item: make('') })).toBe(s);
  });

  it('removes one comment by its number and renumbers the rest', () => {
    const s = keptReducer(keep('a', 'b', 'c'), { type: 'remove', n: 2 });
    expect(numbered(s).map((e) => [e.n, e.item.comment])).toEqual([
      [1, 'a'],
      [2, 'c'],
    ]);
  });

  it('ignores a number that is not in the list', () => {
    const s = keep('a', 'b', 'c');
    for (const n of [0, 4, 1.5, Number.NaN]) {
      expect(keptReducer(s, { type: 'remove', n })).toBe(s);
    }
  });

  it('clears every kept comment', () => {
    const cleared = keptReducer(keep('a', 'b'), { type: 'clear' });
    expect(cleared.items).toEqual([]);
    expect(keptReducer(cleared, { type: 'clear' })).toBe(cleared);
  });

  it('never changes the state or the item it was given', () => {
    const item = Object.freeze(make('x'));
    const s = Object.freeze({ items: Object.freeze([Object.freeze(make('a'))]) });
    const added = keptReducer(s, { type: 'add', item });
    expect(added.items[1]).toBe(item);
    expect(s.items.length).toBe(1);
    expect(keptReducer(s, { type: 'remove', n: 1 }).items).toEqual([]);
    expect(keptReducer(s, { type: 'clear' }).items).toEqual([]);
    expect(s.items.length).toBe(1);
  });

  it('caps at 20, the contract limit of marks per batch', () => {
    expect(KEPT_MAX).toBe(20);
  });
});
