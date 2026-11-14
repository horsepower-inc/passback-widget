import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock('node:child_process', () => ({ execFileSync }));

import { gitBuildId } from './manifest';

describe('gitBuildId', () => {
  beforeEach(() => {
    execFileSync.mockReset();
  });

  it('runs git with stderr ignored so a directory outside a repository prints nothing', () => {
    execFileSync.mockReturnValue(Buffer.from('abc1234\n'));
    gitBuildId('/some/dir');
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--short', 'HEAD'],
      expect.objectContaining({ cwd: '/some/dir', stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  });

  it('returns the trimmed short hash git prints', () => {
    execFileSync.mockReturnValue(Buffer.from('abc1234\n'));
    expect(gitBuildId('/some/dir')).toBe('abc1234');
  });

  it('returns undefined when git fails', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });
    expect(gitBuildId('/some/dir')).toBeUndefined();
  });
});
