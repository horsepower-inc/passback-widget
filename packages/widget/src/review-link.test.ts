import { describe, expect, it } from 'vitest';
import { REVIEW_STORAGE_KEY, reviewOf } from './review-link';

const ID = 'abcdefghijklmnopqrstuv2345';
const OTHER_ID = 'zyxwvutsrqponmlkjihgfe7654';

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

describe('reviewOf', () => {
  it('reads the id from #pb-review followed by 26 characters', () => {
    expect(reviewOf(winOf(`#pb-review${ID}`, ''))).toBe(ID);
  });

  it('does not read the id from a query string', () => {
    const s = store();
    expect(reviewOf(winOf('', `?pb-review=${ID}`, s))).toBeUndefined();
    expect(reviewOf(winOf('#/cart', `?pb-review=${ID}`, s))).toBeUndefined();
    expect(s.getItem(REVIEW_STORAGE_KEY)).toBeNull();
  });

  it('ignores a hash that is too short, too long, upper case, outside a to z and 2 to 7, or another prefix', () => {
    const hashes = [
      '',
      '#pb-review',
      `#pb-review${ID.slice(1)}`,
      `#pb-review${ID}a`,
      `#pb-review${ID.toUpperCase()}`,
      `#pb-review${ID.slice(1)}A`,
      `#pb-review${ID.slice(1)}0`,
      `#pb-review${ID.slice(1)}1`,
      `#pb-review${ID.slice(1)}8`,
      `#pb-review${ID.slice(1)}9`,
      `#pb-review${ID}-x`,
      `#pb-review${ID}\n`,
      `#xpb-review${ID}`,
      `#${ID}`,
      '#pb-pr104',
    ];
    for (const hash of hashes) {
      const s = store();
      expect(reviewOf(winOf(hash, '', s))).toBeUndefined();
      expect(s.getItem(REVIEW_STORAGE_KEY)).toBeNull();
    }
  });

  it('keeps the id for the tab after the address loses it', () => {
    const s = store();
    reviewOf(winOf(`#pb-review${ID}`, '', s));
    expect(s.getItem(REVIEW_STORAGE_KEY)).toBe(ID);
    expect(reviewOf(winOf('', '', s))).toBe(ID);
    expect(reviewOf(winOf('#/cart', '', s))).toBe(ID);
  });

  it('a new link in the same tab replaces the kept id', () => {
    const s = store();
    reviewOf(winOf(`#pb-review${ID}`, '', s));
    expect(reviewOf(winOf(`#pb-review${OTHER_ID}`, '', s))).toBe(OTHER_ID);
    expect(s.getItem(REVIEW_STORAGE_KEY)).toBe(OTHER_ID);
    expect(reviewOf(winOf('', '', s))).toBe(OTHER_ID);
  });

  it('ignores a kept value that is not a well-formed id', () => {
    for (const kept of [
      '',
      ID.slice(1),
      `${ID}a`,
      ID.toUpperCase(),
      `${ID.slice(1)}0`,
      `${ID}\n`,
      `#pb-review${ID}`,
    ]) {
      const s = store();
      s.setItem(REVIEW_STORAGE_KEY, kept);
      expect(reviewOf(winOf('', '', s))).toBeUndefined();
      expect(s.getItem(REVIEW_STORAGE_KEY)).toBe(kept);
    }
  });

  it('does not touch the passback:pr key', () => {
    const s = store();
    reviewOf(winOf(`#pb-review${ID}`, '', s));
    expect(s.getItem('passback:pr')).toBeNull();
    s.setItem('passback:pr', '104');
    reviewOf(winOf(`#pb-review${OTHER_ID}`, '', s));
    reviewOf(winOf('', '', s));
    expect(s.getItem('passback:pr')).toBe('104');
    expect(REVIEW_STORAGE_KEY).toBe('passback:review');
  });

  it('returns the id from the address when session storage throws, and undefined when there is none', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(reviewOf(winOf(`#pb-review${ID}`, '', boom))).toBe(ID);
    expect(reviewOf(winOf('', '', boom))).toBeUndefined();

    const blocked = {
      location: { hash: `#pb-review${ID}`, search: '' },
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    } as unknown as Pick<Window, 'location' | 'sessionStorage'>;
    expect(reviewOf(blocked)).toBe(ID);

    const unreadable = {
      get location(): Location {
        throw new Error('unreadable');
      },
      sessionStorage: boom,
    } as unknown as Pick<Window, 'location' | 'sessionStorage'>;
    expect(reviewOf(unreadable)).toBeUndefined();
  });
});
