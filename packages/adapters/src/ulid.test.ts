import { describe, expect, it } from 'vitest';
import { ulid } from './ulid';

const BATCH_ID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

describe('ulid', () => {
  it('ulid matches the Batch id pattern', () => {
    expect(ulid()).toMatch(BATCH_ID_RE);
  });

  it('ulid encodes the time prefix', () => {
    expect(ulid(1469918176385).slice(0, 10)).toBe('01ARYZ6S41');
  });

  it('ulid returns 1000 distinct ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
    expect(ids.size).toBe(1000);
  });
});
