import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs connect', () => {
  it('parses "connect linear" and "connect github --to acme/web --json" without a key', () => {
    expect(parseArgs(['connect', 'linear'])).toEqual({
      cmd: 'connect',
      tracker: 'linear',
      json: false,
    });
    expect(parseArgs(['connect', 'github', '--to', 'acme/web', '--json'])).toEqual({
      cmd: 'connect',
      tracker: 'github',
      to: 'acme/web',
      json: true,
    });
  });

  it('parses connect plane with --intake and --no-intake and leaves intake out when neither is given', () => {
    const base = ['connect', 'plane', '--workspace', 'w', '--key', 'k'];
    expect(parseArgs([...base, '--intake'])).toEqual({
      cmd: 'connect',
      tracker: 'plane',
      key: 'k',
      workspace: 'w',
      intake: true,
      json: false,
    });
    expect(parseArgs([...base, '--no-intake'])).toMatchObject({ intake: false });
    expect(parseArgs(base)).not.toHaveProperty('intake');
  });

  it('parses connect plane --keep-key with --intake and --no-intake', () => {
    const base = ['connect', 'plane', '--keep-key'];
    expect(parseArgs([...base, '--intake'])).toEqual({
      cmd: 'connect',
      tracker: 'plane',
      keepKey: true,
      intake: true,
      json: false,
    });
    expect(parseArgs([...base, '--no-intake'])).toMatchObject({ keepKey: true, intake: false });
    expect(parseArgs(base)).not.toHaveProperty('intake');
  });

  it('refuses --intake with --no-intake and refuses either flag on another tracker', () => {
    const usage = { cmd: 'usage', error: 'connect' };
    const plane = ['connect', 'plane', '--workspace', 'w', '--key', 'k'];
    expect(parseArgs([...plane, '--intake', '--no-intake'])).toEqual(usage);
    expect(parseArgs(['connect', 'plane', '--keep-key', '--intake', '--no-intake'])).toEqual(usage);
    for (const flag of ['--intake', '--no-intake']) {
      expect(parseArgs(['connect', 'github', '--to', 'acme/web', flag])).toEqual(usage);
      expect(parseArgs(['connect', 'github', '--keep-key', flag])).toEqual(usage);
      expect(parseArgs(['connect', 'webhook', '--url', 'https://x.test/h', flag])).toEqual(usage);
    }
  });
});

describe('parseArgs connect webhook', () => {
  it('parses "connect webhook --url" and refuses a missing or non-https address', () => {
    expect(parseArgs(['connect', 'webhook', '--url', 'https://hooks.test/in'])).toEqual({
      cmd: 'connect-webhook',
      url: 'https://hooks.test/in',
      json: false,
    });
    expect(
      parseArgs([
        'connect',
        'webhook',
        '--url',
        'https://hooks.test/in',
        '--site',
        'shop',
        '--json',
      ]),
    ).toEqual({ cmd: 'connect-webhook', url: 'https://hooks.test/in', site: 'shop', json: true });
    const usage = { cmd: 'usage', error: 'connect' };
    expect(parseArgs(['connect', 'webhook'])).toEqual(usage);
    expect(parseArgs(['connect', 'webhook', '--url', 'http://hooks.test/in'])).toEqual(usage);
    expect(parseArgs(['connect', 'webhook', '--url', 'https://h.test', '--key', 'k'])).toEqual(
      usage,
    );
  });
});
