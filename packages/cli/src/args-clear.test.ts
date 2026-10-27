import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs clear', () => {
  it('parses clear without a scope flag as a workspace clear that keeps the settings', () => {
    expect(parseArgs(['clear'])).toEqual({
      cmd: 'clear',
      scope: 'workspace',
      settings: false,
      yes: false,
    });
  });

  it('parses fixed, tracker and all as their scopes and all as settings', () => {
    expect(parseArgs(['clear', '--fixed'])).toEqual({
      cmd: 'clear',
      scope: 'fixed',
      settings: false,
      yes: false,
    });
    expect(parseArgs(['clear', '--tracker'])).toEqual({
      cmd: 'clear',
      scope: 'tracker',
      settings: false,
      yes: false,
    });
    expect(parseArgs(['clear', '--all'])).toEqual({
      cmd: 'clear',
      scope: 'workspace',
      settings: true,
      yes: false,
    });
  });

  it('parses yes and root', () => {
    expect(parseArgs(['clear', '--yes', '--root', 'app'])).toEqual({
      cmd: 'clear',
      scope: 'workspace',
      settings: false,
      yes: true,
      root: 'app',
    });
    expect(parseArgs(['clear', '--root', 'app', '--all', '--yes'])).toEqual({
      cmd: 'clear',
      scope: 'workspace',
      settings: true,
      yes: true,
      root: 'app',
    });
  });

  it('returns usage for two scope flags, an unknown flag and a root without a value', () => {
    for (const argv of [
      ['clear', '--fixed', '--tracker'],
      ['clear', '--fixed', '--all'],
      ['clear', '--tracker', '--all'],
      ['clear', '--bogus'],
      ['clear', 'extra'],
      ['clear', '--root'],
      ['clear', '--root', '--yes'],
    ]) {
      expect(parseArgs(argv)).toEqual({ cmd: 'usage', error: 'clear' });
    }
  });
});
