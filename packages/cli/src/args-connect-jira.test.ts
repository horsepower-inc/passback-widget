import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs connect jira', () => {
  it('parses connect jira with --to and --site and refuses --key and --workspace for it', () => {
    expect(parseArgs(['connect', 'jira', '--to', 'ENG', '--site', 'shop', '--json'])).toEqual({
      cmd: 'connect',
      tracker: 'jira',
      to: 'ENG',
      site: 'shop',
      json: true,
    });
    expect(parseArgs(['connect', 'jira'])).toEqual({
      cmd: 'connect',
      tracker: 'jira',
      json: false,
    });
    expect(parseArgs(['connect', 'jira', '--key', 'k'])).toEqual({
      cmd: 'usage',
      error: 'connect',
    });
    expect(parseArgs(['connect', 'jira', '--workspace', 'w'])).toEqual({
      cmd: 'usage',
      error: 'connect',
    });
  });
});
