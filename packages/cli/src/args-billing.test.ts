import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs billing', () => {
  it('parses "billing" and "billing --json"', () => {
    expect(parseArgs(['billing'])).toEqual({ cmd: 'billing', json: false });
    expect(parseArgs(['billing', '--json'])).toEqual({ cmd: 'billing', json: true });
  });

  it('returns usage for billing with an unknown flag', () => {
    expect(parseArgs(['billing', '--open'])).toEqual({ cmd: 'usage', error: 'billing' });
  });

  it('parses "init --site --yes" and refuses --yes without --site', () => {
    expect(parseArgs(['init', '--site', '--yes'])).toEqual({ cmd: 'init', site: true, yes: true });
    expect(parseArgs(['init', '--yes'])).toEqual({ cmd: 'usage', error: 'init --yes' });
  });
});
