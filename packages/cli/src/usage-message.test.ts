import { describe, expect, it } from 'vitest';
import { usageMessage } from './usage-message';

describe('usageMessage', () => {
  it('says unknown command for a word that is not a command', () => {
    for (const error of ['bogus', '', '???', 'connectivity', ' dev']) {
      expect(usageMessage(error)).toBe(`passback: unknown command '${error}'`);
    }
  });

  it('says invalid arguments for a known command, with or without its bad argument', () => {
    for (const command of [
      'dev',
      'init',
      'review-pr',
      'pr-check',
      'snapshot',
      'clear',
      'login',
      'whoami',
      'logout',
      'site',
      'connect',
    ]) {
      for (const error of [command, `${command} abc`, `${command}\t--bad`]) {
        expect(usageMessage(error)).toBe(`passback: invalid arguments for '${error}'`);
      }
    }
  });

  it('says invalid option for an option', () => {
    for (const error of ['--agents vim', '--bad', '--']) {
      expect(usageMessage(error)).toBe(`passback: invalid option '${error}'`);
    }
  });
});
