import { describe, expect, it } from 'vitest';
import { destOf, emptyKept, keptReducer, type Dest, type Kept, type KeptComment } from './kept';

const item = (comment: string, dest?: Dest): KeptComment => ({
  element: {} as Element,
  selector: 'div',
  offset: { x: 0, y: 0 } as KeptComment['offset'],
  comment,
  ...(dest ? { dest } : {}),
});
const of = (...items: KeptComment[]): Kept => ({ items });
const names = (state: Kept) => state.items.map((i) => i.comment);

describe('kept destination', () => {
  it('destOf reads the agent when a comment has no destination', () => {
    expect(destOf(item('a'))).toBe('agent');
    expect(destOf(item('a', 'agent'))).toBe('agent');
    expect(destOf(item('a', 'tracker'))).toBe('tracker');
  });

  it('the dest event sets one comment destination and returns the same state when nothing changes', () => {
    const state = of(item('a'), item('b'));
    const next = keptReducer(state, { type: 'dest', n: 2, dest: 'tracker' });
    expect(next).not.toBe(state);
    expect(next.items.map(destOf)).toEqual(['agent', 'tracker']);
    expect(keptReducer(next, { type: 'dest', n: 2, dest: 'tracker' })).toBe(next);
    expect(keptReducer(state, { type: 'dest', n: 1, dest: 'agent' })).toBe(state);
    for (const n of [0, 3, -1, 1.5, NaN])
      expect(keptReducer(state, { type: 'dest', n, dest: 'tracker' })).toBe(state);
  });

  it('clear with a destination removes only the comments of that destination and keeps their order', () => {
    const state = of(item('a'), item('b', 'tracker'), item('c', 'agent'), item('d', 'tracker'));
    expect(names(keptReducer(state, { type: 'clear', dest: 'tracker' }))).toEqual(['a', 'c']);
    expect(names(keptReducer(state, { type: 'clear', dest: 'agent' }))).toEqual(['b', 'd']);
    const agents = of(item('a'));
    expect(keptReducer(agents, { type: 'clear', dest: 'tracker' })).toBe(agents);
  });

  it('clear without a destination still empties the list', () => {
    const state = of(item('a'), item('b', 'tracker'));
    expect(keptReducer(state, { type: 'clear' }).items).toEqual([]);
    const empty = emptyKept();
    expect(keptReducer(empty, { type: 'clear' })).toBe(empty);
  });

  it('the dest event never mutates the state or the items it was given', () => {
    const first = item('a');
    const state = of(first, item('b', 'tracker'));
    const frozen = Object.freeze({ items: Object.freeze([...state.items]) }) as Kept;
    const before = [...state.items];
    keptReducer(frozen, { type: 'dest', n: 1, dest: 'tracker' });
    keptReducer(frozen, { type: 'clear', dest: 'tracker' });
    expect(state.items).toEqual(before);
    expect(first.dest).toBeUndefined();
  });
});
