// The only code that starts `gh`: a no-shell spawn behind the GhRun seam of @passback/adapters.

import { spawn } from 'node:child_process';
import type { GhRun } from '@passback/adapters/local';

export function runProcess(
  file: string,
  args: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString('utf8') });
    });
    // A process that exits without reading stdin makes the write fail with EPIPE; the exit code
    // is the answer then, so the stream error is not one.
    child.stdin.on('error', () => {});
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

export function createGhRun(): GhRun {
  return (args, stdin) => runProcess('gh', args, stdin);
}
