// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { newUlid } from './ulid';

const BATCH_ID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function fixedRandom(byte: number): (n: number) => Uint8Array {
  return (n) => new Uint8Array(n).fill(byte);
}

describe('newUlid', () => {
  it('returns 26 Crockford characters that match the Batch id pattern', () => {
    const id = newUlid(1_700_000_000_000, fixedRandom(0));

    expect(id).toHaveLength(26);
    expect(id).toMatch(BATCH_ID_PATTERN);
  });

  it('encodes the timestamp in the first 10 characters', () => {
    const a = newUlid(1_700_000_000_000, fixedRandom(0));
    const b = newUlid(1_700_000_000_000, fixedRandom(255));

    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
  });

  it('sorts by time: a later timestamp gives a greater id', () => {
    const earlier = newUlid(1_700_000_000_000, fixedRandom(0));
    const later = newUlid(1_700_000_000_001, fixedRandom(0));

    expect(later > earlier).toBe(true);
  });

  it('takes its random part from the injected source', () => {
    const low = newUlid(1_700_000_000_000, fixedRandom(0));
    const high = newUlid(1_700_000_000_000, fixedRandom(255));

    expect(low.slice(10)).not.toBe(high.slice(10));
  });

  it('gives two calls in the same millisecond different ids', () => {
    let calls = 0;
    const random = (n: number): Uint8Array => {
      calls += 1;
      return new Uint8Array(n).fill(calls);
    };

    const a = newUlid(1_700_000_000_000, random);
    const b = newUlid(1_700_000_000_000, random);

    expect(a).not.toBe(b);
  });
});
