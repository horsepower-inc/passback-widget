import { afterEach, describe, expect, it, vi } from 'vitest';
import { keptOffset, rowNumber, storeOf } from './inbox-numbers';

const winOf = (inbox: unknown) => ({ __passback: { inbox } }) as unknown as Window;
const store = (numbers: Record<string, number | undefined>) => ({
  rows: () => Object.keys(numbers).map((id) => ({ id })),
  numberOf: (id: string) => numbers[id],
  subscribe: vi.fn(),
});

afterEach(() => vi.unstubAllGlobals());

describe('inbox numbers', () => {
  it('counts the rows that have a list number and returns 0 without a store', () => {
    expect(keptOffset(winOf(store({ a: 1, b: 2, c: undefined })))).toBe(2);
    expect(keptOffset({} as Window)).toBe(0);
    expect(keptOffset(winOf(store({})))).toBe(0);
  });

  it('gives the list number of an inbox row and undefined for a row without one', () => {
    const win = winOf(store({ a: 1, b: undefined }));
    expect(storeOf(win)).toBeDefined();
    expect(rowNumber(win, 'a')).toBe(1);
    expect(rowNumber(win, 'b')).toBeUndefined();
    expect(rowNumber({} as Window, 'a')).toBeUndefined();
  });

  it('ignores a store of the wrong shape and a store that throws', () => {
    const wrong = winOf({ rows: () => [], numberOf: 1 });
    expect([storeOf(wrong), keptOffset(wrong), rowNumber(wrong, 'a')]).toEqual([
      undefined,
      0,
      undefined,
    ]);
    const boom = () => {
      throw new Error('boom');
    };
    const bad = winOf({ rows: boom, numberOf: boom, subscribe: vi.fn() });
    expect([keptOffset(bad), rowNumber(bad, 'a')]).toEqual([0, undefined]);
    const getter = {
      get __passback(): never {
        return boom();
      },
    } as unknown as Window;
    expect([storeOf(getter), keptOffset(getter)]).toEqual([undefined, 0]);
  });

  it('returns 0 for the offset when __PB_LOCAL__ is false', () => {
    vi.stubGlobal('__PB_LOCAL__', false);
    expect(keptOffset(winOf(store({ a: 1, b: 2 })))).toBe(0);
    vi.stubGlobal('__PB_LOCAL__', true);
    expect(keptOffset(winOf(store({ a: 1, b: 2 })))).toBe(2);
  });
});
