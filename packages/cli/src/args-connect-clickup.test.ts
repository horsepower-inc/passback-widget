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

  it('needs a key for clickup and refuses --workspace', () => {
    expect(parseArgs(['connect', 'clickup'])).toEqual({ cmd: 'usage', error: 'connect' });
    expect(parseArgs(['connect', 'clickup', '--key', 'pk_tok', '--workspace', 'w'])).toEqual({
      cmd: 'usage',
      error: 'connect',
    });
  });
});
