import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';
import { readRoot } from './root-flag';

describe('readRoot', () => {
  it('reads the value after --root and gives {} without the flag', () => {
    expect(readRoot(['--root', 'apps/web'])).toEqual({ root: 'apps/web' });
    expect(readRoot(['--agents', 'claude', '--root', '/tmp/app'])).toEqual({ root: '/tmp/app' });
    expect(readRoot([])).toEqual({});
    expect(readRoot(['--agents', 'claude'])).toEqual({});
  });

  it('gives undefined when --root has no value or a flag as its value', () => {
    expect(readRoot(['--root'])).toBeUndefined();
    expect(readRoot(['--root', '--agents', 'claude'])).toBeUndefined();
  });

  it('returns usage for dev and init when --root has no usable value', () => {
    for (const cmd of ['dev', 'init']) {
      for (const rest of [
        ['--root'],
        ['--root', '--agents', 'claude'],
        ['--root', '--app'],
        ['--root', '--site', '--json'],
      ]) {
        expect(parseArgs([cmd, ...rest])).toEqual({ cmd: 'usage', error: '--root' });
      }
    }
  });
});
