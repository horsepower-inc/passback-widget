import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProjectRoot, resolveRootOption } from './project-root';

function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'passback-root-')));
}

describe('findProjectRoot', () => {
  it('returns the start directory when it holds a .passback directory', () => {
    const dir = tempDir();
    mkdirSync(join(dir, '.passback'));
    expect(findProjectRoot(dir)).toBe(dir);
  });

  it('returns the nearest ancestor that holds a .passback directory', () => {
    const dir = tempDir();
    mkdirSync(join(dir, '.passback'));
    const nested = join(dir, 'apps', 'admin');
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(dir);
  });

  it('falls back to the git top-level directory when no .passback directory exists', () => {
    const dir = tempDir();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const nested = join(dir, 'apps', 'admin');
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(dir);
  });

  it('falls back to the start directory outside a git repository', () => {
    const dir = tempDir();
    expect(findProjectRoot(dir)).toBe(dir);
  });
});

describe('resolveRootOption', () => {
  it('resolves a relative root option against the Vite root and keeps the Vite root without one', () => {
    expect(resolveRootOption('/repo/apps/admin', '../..')).toBe(resolve('/repo'));
    expect(resolveRootOption('/repo/apps/admin', undefined)).toBe('/repo/apps/admin');
  });
});
