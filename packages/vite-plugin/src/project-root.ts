import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function hasPassbackDir(dir: string): boolean {
  const candidate = join(dir, '.passback');
  return existsSync(candidate) && statSync(candidate).isDirectory();
}

function gitTopLevel(cwd: string): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === '' ? undefined : out;
  } catch {
    return undefined;
  }
}

export function findProjectRoot(start: string): string {
  const origin = resolve(start);
  let dir = origin;
  for (;;) {
    if (hasPassbackDir(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return gitTopLevel(origin) ?? origin;
}

export function resolveRootOption(viteRoot: string, root: string | undefined): string {
  return root === undefined ? viteRoot : resolve(viteRoot, root);
}
