import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

const usage = { cmd: 'usage', error: 'connect' };

describe('parseArgs connect gitlab', () => {
  it('parses connect gitlab with a key, an address, a project and a site', () => {
    expect(
      parseArgs([
        'connect',
        'gitlab',
        '--key',
        'glpat-x',
        '--url',
        'https://gitlab.example.com',
        '--to',
        'acme/web',
        '--site',
        'shop',
        '--json',
      ]),
    ).toEqual({
      cmd: 'connect',
      tracker: 'gitlab',
      key: 'glpat-x',
      url: 'https://gitlab.example.com',
      to: 'acme/web',
      site: 'shop',
      json: true,
    });
    expect(parseArgs(['connect', 'gitlab', '--key', 'glpat-x'])).toEqual({
      cmd: 'connect',
      tracker: 'gitlab',
      key: 'glpat-x',
      json: false,
    });
  });

  it('needs a key for gitlab and refuses --workspace', () => {
    expect(parseArgs(['connect', 'gitlab'])).toEqual(usage);
    expect(parseArgs(['connect', 'gitlab', '--workspace', 'w', '--key', 'k'])).toEqual(usage);
  });

  it('refuses --url for another tracker and an address that is not https', () => {
    expect(parseArgs(['connect', 'github', '--url', 'https://gitlab.example.com'])).toEqual(usage);
    expect(
      parseArgs(['connect', 'plane', '--key', 'k', '--workspace', 'w', '--url', 'https://x.test']),
    ).toEqual(usage);
    expect(parseArgs(['connect', 'gitlab', '--key', 'k', '--url', 'http://gitlab.test'])).toEqual(
      usage,
    );
    expect(parseArgs(['connect', 'gitlab', '--key', 'k', '--url', 'gitlab.test'])).toEqual(usage);
  });
});
