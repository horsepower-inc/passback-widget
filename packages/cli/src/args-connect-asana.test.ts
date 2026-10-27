import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs connect asana', () => {
  it('parses connect asana with a key, a project and a site', () => {
    expect(
      parseArgs([
        'connect',
        'asana',
        '--key',
        'tok',
        '--to',
        'Website',
        '--site',
        'shop',
        '--json',
      ]),
    ).toEqual({
      cmd: 'connect',
      tracker: 'asana',
      key: 'tok',
      to: 'Website',
      site: 'shop',
      json: true,
    });
  });

  it('needs a key for asana and refuses --workspace', () => {
    expect(parseArgs(['connect', 'asana'])).toEqual({ cmd: 'usage', error: 'connect' });
    expect(parseArgs(['connect', 'asana', '--key', 'tok', '--workspace', 'w'])).toEqual({
      cmd: 'usage',
      error: 'connect',
    });
  });
});
