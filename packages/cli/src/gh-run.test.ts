import { describe, expect, it } from 'vitest';
import { runProcess } from './gh-run';

describe('runProcess', () => {
  it('passes stdin to the process and returns its stdout and exit code', async () => {
    const script = 'process.stdin.pipe(process.stdout)';
    const result = await runProcess(process.execPath, ['-e', script], 'hello');
    expect(result).toEqual({ code: 0, stdout: 'hello' });
  });

  it('returns the exit code of a failing process', async () => {
    const result = await runProcess(process.execPath, [
      '-e',
      "process.stdout.write('x');process.exit(3)",
    ]);
    expect(result).toEqual({ code: 3, stdout: 'x' });
  });

  it('rejects when the file does not exist', async () => {
    await expect(runProcess('passback-no-such-binary', [])).rejects.toThrow(/ENOENT/);
  });
});
