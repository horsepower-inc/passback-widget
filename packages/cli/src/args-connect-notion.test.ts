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
  it('approves in the browser without a key and refuses --workspace', () => {
    expect(parseConnect(['notion'])).toEqual({ cmd: 'connect', tracker: 'notion', json: false });
    expect(parseConnect(['notion', '--to', 'Bugs'])).toEqual({
      cmd: 'connect',
      tracker: 'notion',
      to: 'Bugs',
      json: false,
    });
    expect(parseConnect(['notion', '--key', 'ntn_secret', '--workspace', 'w'])).toEqual(usage);
    expect(parseConnect(['notion', '--key', 'ntn_secret', '--token', 'T'])).toEqual(usage);
  });
});
