import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs connect clickup', () => {
  it('parses connect clickup with a key, a list and a site', () => {
    expect(
      parseArgs([
        'connect',
        'clickup',
        '--key',
        'pk_tok',
        '--to',
        'Product / Web / Bugs',
        '--site',
        'shop',
        '--json',
      ]),
    ).toEqual({
      cmd: 'connect',
      tracker: 'clickup',
      key: 'pk_tok',
      to: 'Product / Web / Bugs',
      site: 'shop',
      json: true,
    });
  });

  it('approves in the browser without a key and refuses --workspace', () => {
    expect(parseArgs(['connect', 'clickup'])).toEqual({
      cmd: 'connect',
      tracker: 'clickup',
      json: false,
    });
    expect(parseArgs(['connect', 'clickup', '--key', 'pk_tok', '--workspace', 'w'])).toEqual({
      cmd: 'usage',
      error: 'connect',
    });
  });
});
