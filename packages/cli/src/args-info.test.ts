import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs info flags', () => {
  it('parses --help, -h and help as a request for the usage text', () => {
    for (const flag of ['--help', '-h', 'help']) {
      expect(parseArgs([flag])).toEqual({ cmd: 'usage', help: true });
      expect(parseArgs([flag, 'init'])).toEqual({ cmd: 'usage', help: true });
    }
  });

  it('still parses --version', () => {
    expect(parseArgs(['--version'])).toEqual({ cmd: 'version' });
    expect(parseArgs(['--version', 'init'])).toEqual({ cmd: 'version' });
  });
});
