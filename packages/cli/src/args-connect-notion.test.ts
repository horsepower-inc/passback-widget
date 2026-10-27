import { describe, expect, it } from 'vitest';
import { parseConnect } from './args-connect';

const usage = { cmd: 'usage', error: 'connect' };

describe('parseConnect notion', () => {
  it('parses connect notion with a key, a database and a site', () => {
    expect(
      parseConnect(['notion', '--key', 'ntn_secret', '--to', 'Bugs', '--site', 'shop', '--json']),
    ).toEqual({
      cmd: 'connect',
      tracker: 'notion',
      key: 'ntn_secret',
      to: 'Bugs',
      site: 'shop',
      json: true,
    });
  });
  it('needs a key for notion and refuses --workspace', () => {
    expect(parseConnect(['notion'])).toEqual(usage);
    expect(parseConnect(['notion', '--to', 'Bugs'])).toEqual(usage);
    expect(parseConnect(['notion', '--key', 'ntn_secret', '--workspace', 'w'])).toEqual(usage);
    expect(parseConnect(['notion', '--key', 'ntn_secret', '--token', 'T'])).toEqual(usage);
  });
});
