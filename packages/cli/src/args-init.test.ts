import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs init --apply', () => {
  it('parses "init --apply"', () => {
    expect(parseArgs(['init', '--apply'])).toEqual({ cmd: 'init', apply: true });
  });

  it('returns usage for "dev --apply"', () => {
    expect(parseArgs(['dev', '--apply'])).toEqual({ cmd: 'usage', error: 'dev --apply' });
  });
});
