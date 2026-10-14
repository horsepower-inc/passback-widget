import { describe, expect, it } from 'vitest';
import { PR_STORAGE_KEY, pullRequestOf } from './pr-link';

function store() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function winOf(hash: string, search: string, sessionStorage: unknown = store()) {
  return { location: { hash, search }, sessionStorage } as unknown as Pick<
    Window,
    'location' | 'sessionStorage'
  >;
}

describe('pullRequestOf', () => {
  it('reads the number from #pb-pr104', () => {
    expect(pullRequestOf(winOf('#pb-pr104', ''))).toBe(104);
  });

  it('reads the number from ?pb-pr=104 when the hash is a route', () => {
    expect(pullRequestOf(winOf('#/cart', '?pb-pr=104'))).toBe(104);
  });

  it('prefers the hash over the query', () => {
    expect(pullRequestOf(winOf('#pb-pr7', '?pb-pr=104'))).toBe(7);
  });

  it('keeps the number for the tab after the address loses it', () => {
    const s = store();
    pullRequestOf(winOf('#pb-pr104', '', s));
    expect(s.getItem(PR_STORAGE_KEY)).toBe('104');
    expect(pullRequestOf(winOf('', '', s))).toBe(104);
  });

  it('a new link in the same tab replaces the kept number', () => {
    const s = store();
    pullRequestOf(winOf('#pb-pr104', '', s));
    pullRequestOf(winOf('#pb-pr105', '', s));
    expect(pullRequestOf(winOf('', '', s))).toBe(105);
  });

  it('ignores zero, a leading zero, letters and more than nine digits', () => {
    for (const hash of ['#pb-pr0', '#pb-pr0104', '#pb-prabc', '#pb-pr1234567890', '#pb-pr104x', '#pb-pr-4']) {
      expect(pullRequestOf(winOf(hash, ''))).toBeUndefined();
    }
    for (const search of ['?pb-pr=0', '?pb-pr=010', '?pb-pr=x', '?pb-pr=1234567890', '?pb-pr=+4']) {
      expect(pullRequestOf(winOf('', search))).toBeUndefined();
    }
    expect(pullRequestOf(winOf('#pb-pr0', '?pb-pr=9'))).toBe(9);
  });

  it('returns the number from the address when session storage throws, and undefined when there is none', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(pullRequestOf(winOf('#pb-pr104', '', boom))).toBe(104);
    expect(pullRequestOf(winOf('', '', boom))).toBeUndefined();
  });
});
