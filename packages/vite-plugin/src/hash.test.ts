import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashLocation } from './hash';

describe('hashLocation', () => {
  it('hashLocation returns the first 8 hex characters of the sha256 of the location', () => {
    const expected = createHash('sha256').update('abc').digest('hex').slice(0, 8);
    expect(hashLocation('abc')).toBe('ba7816bf');
    expect(hashLocation('abc')).toBe(expected);
  });

  it('hashLocation always returns 8 lower case hex characters', () => {
    expect(hashLocation('src/App.tsx:12:3')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashLocation('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('hashLocation is stable for one location and differs between locations', () => {
    expect(hashLocation('src/App.tsx:12:3')).toBe(hashLocation('src/App.tsx:12:3'));
    expect(hashLocation('src/App.tsx:12:3')).not.toBe(hashLocation('src/App.tsx:12:4'));
  });
});
