import { describe, expect, it } from 'vitest';
import { keyedSite } from './init-site-key';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

describe('keyedSite', () => {
  it('uses the default API when PASSBACK_API_URL is not set', () => {
    const { io } = capture();
    expect(keyedSite('pb_abc', {}, io)).toEqual({
      siteKey: 'pb_abc',
      endpoint: 'https://api.passback.dev',
    });
  });

  it('takes the endpoint from PASSBACK_API_URL when it is set', () => {
    const { io } = capture();
    const site = keyedSite('pb_abc', { PASSBACK_API_URL: 'https://api.example.test' }, io);
    expect(site?.endpoint).toBe('https://api.example.test');
  });

  it('keeps the site key as given and says no login is needed', () => {
    const { io, out, err } = capture();
    const site = keyedSite('Pb-Key_9', {}, io);
    expect(site?.siteKey).toBe('Pb-Key_9');
    expect(out).toEqual([
      'Using site key Pb-Key_9 with endpoint https://api.passback.dev (no login needed).',
    ]);
    expect(err).toEqual([]);
  });

  it('refuses a key with characters outside letters, digits, underscore and dash', () => {
    for (const key of ['', 'a b', 'a/b', 'k.ey', 'x'.repeat(129)]) {
      const { io, out, err } = capture();
      expect(keyedSite(key, {}, io)).toBeUndefined();
      expect(out).toEqual([]);
      expect(err).toEqual([
        'passback: the site key may hold only letters, digits, underscore and dash.',
      ]);
    }
  });
});
